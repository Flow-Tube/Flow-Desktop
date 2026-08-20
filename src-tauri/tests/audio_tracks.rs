//! Guards on audio-track resolution.
//!
//! Every case here is a real response shape that broke playback: the selected
//! audio must always end up with exactly one track flagged default, because the
//! synthetic DASH builder keys the audio AdaptationSet off that flag. When no
//! track carries it the manifest comes out with no audio — and the clients that
//! produce these shapes also serve no muxed format, so playback falls back to a
//! video-only URL and the video plays silently.

use flow_desktop_lib::api::innertube::extractors::player::collect_audio_tracks;
use serde_json::{Value, json};

const UA: &str = "test-agent";

fn audio_format(itag: u64, mime: &str, bitrate: u64) -> Value {
    json!({
        "itag": itag,
        "mimeType": mime,
        "bitrate": bitrate,
        "url": format!("https://rr1---sn-test.googlevideo.com/videoplayback?itag={itag}&c=VISIONOS"),
        "initRange": { "start": "0", "end": "258" },
        "indexRange": { "start": "259", "end": "1275" },
    })
}

fn with_xtags(mut format: Value, xtags: &str) -> Value {
    format["xtags"] = json!(xtags);
    format
}

fn with_audio_track(
    mut format: Value,
    id: &str,
    display: &str,
    default: bool,
    dubbed: bool,
) -> Value {
    format["audioTrack"] = json!({
        "id": id,
        "displayName": display,
        "audioIsDefault": default,
        "isAutoDubbed": dubbed,
    });
    format
}

fn streaming_data(formats: Vec<Value>) -> Value {
    json!({ "adaptiveFormats": formats })
}

/// The regression: VISIONOS returns each audio itag twice — a plain copy and an
/// `xtags` variant — with identical identity fields, so they collide on one dedup
/// key. The higher-bitrate twin used to overwrite the entry holding the default
/// flag, leaving a track list with no default at all.
#[test]
fn xtags_duplicate_of_an_itag_never_costs_the_default_flag() {
    let data = streaming_data(vec![
        audio_format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 130_000),
        with_xtags(
            audio_format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 260_000),
            "Cg8KBWFjb250EgZkdWJiZWQ",
        ),
    ]);

    let tracks = collect_audio_tracks(&data, UA);

    assert_eq!(tracks.len(), 1, "the two copies share one identity");
    assert!(
        tracks[0].is_default,
        "a track list with no default yields a manifest with no audio"
    );
}

/// The plain twin wins even though the tagged one advertises a higher bitrate:
/// googlevideo refuses sustained playback on the tagged variants.
#[test]
fn the_plain_twin_beats_the_higher_bitrate_xtags_variant() {
    let data = streaming_data(vec![
        with_xtags(
            audio_format(251, "audio/webm; codecs=\"opus\"", 260_000),
            "Cg8KBWFjb250EgZkdWJiZWQ",
        ),
        audio_format(251, "audio/webm; codecs=\"opus\"", 130_000),
    ]);

    let tracks = collect_audio_tracks(&data, UA);

    assert_eq!(tracks.len(), 1);
    assert_eq!(
        tracks[0].bitrate,
        Some(130_000),
        "the untagged copy must win regardless of bitrate"
    );
    assert!(tracks[0].is_default);
}

/// Responses that never mention `audioTrack` at all (any video without dubs) must
/// still produce a default rather than an unflagged list.
#[test]
fn a_response_with_no_audio_track_metadata_still_yields_a_default() {
    let data = streaming_data(vec![
        audio_format(139, "audio/mp4; codecs=\"mp4a.40.5\"", 48_000),
        audio_format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 130_000),
        audio_format(251, "audio/webm; codecs=\"opus\"", 140_000),
    ]);

    let tracks = collect_audio_tracks(&data, UA);

    assert_eq!(
        tracks.iter().filter(|track| track.is_default).count(),
        1,
        "exactly one track must be default"
    );
    assert!(tracks[0].is_default, "the default sorts first");
    assert!(tracks[0].available);
}

/// When the response *does* declare a default, that choice is authoritative — the
/// promotion fallback must not override it or add a second one.
#[test]
fn a_declared_default_is_respected_over_dubbed_tracks() {
    let data = streaming_data(vec![
        with_audio_track(
            audio_format(139, "audio/mp4; codecs=\"mp4a.40.5\"", 300_000),
            "ar.10",
            "Arabic",
            false,
            true,
        ),
        with_audio_track(
            audio_format(251, "audio/webm; codecs=\"opus\"", 140_000),
            "en-US.4",
            "English (US) original",
            true,
            false,
        ),
        with_audio_track(
            audio_format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 320_000),
            "hi.10",
            "Hindi",
            false,
            true,
        ),
    ]);

    let tracks = collect_audio_tracks(&data, UA);

    assert_eq!(
        tracks.iter().filter(|track| track.is_default).count(),
        1,
        "a dubbed track must never be promoted alongside a declared default"
    );
    assert_eq!(tracks[0].label, "English (US) original");
    assert!(tracks[0].is_default);
}

/// A dubbed track must never become the default just because it is the only thing
/// left after dedup ordering — the promotion prefers the undubbed candidate.
#[test]
fn promotion_prefers_an_undubbed_candidate() {
    let data = streaming_data(vec![
        with_audio_track(
            audio_format(139, "audio/mp4; codecs=\"mp4a.40.5\"", 300_000),
            "ar.10",
            "Arabic",
            false,
            true,
        ),
        audio_format(251, "audio/webm; codecs=\"opus\"", 140_000),
    ]);

    let tracks = collect_audio_tracks(&data, UA);

    let default = tracks
        .iter()
        .find(|track| track.is_default)
        .expect("a default must exist");
    assert_eq!(
        default.label, "Original audio",
        "the undubbed track is the one to promote"
    );
}

/// Formats without a usable URL are skipped, and skipping them must not leave the
/// remaining list without a default.
#[test]
fn formats_without_a_url_are_skipped_without_losing_the_default() {
    let mut cipher_only = audio_format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 130_000);
    cipher_only["url"] = Value::Null;
    cipher_only["signatureCipher"] = json!("s=abc&sp=sig&url=https://example.invalid/x");

    let data = streaming_data(vec![
        cipher_only,
        audio_format(251, "audio/webm; codecs=\"opus\"", 140_000),
    ]);

    let tracks = collect_audio_tracks(&data, UA);

    assert_eq!(tracks.len(), 1, "the cipher-only format is unusable here");
    assert!(tracks[0].is_default);
}

#[test]
fn every_track_carries_the_fetching_user_agent() {
    let data = streaming_data(vec![audio_format(
        251,
        "audio/webm; codecs=\"opus\"",
        140_000,
    )]);

    let tracks = collect_audio_tracks(&data, UA);

    assert_eq!(
        tracks[0].user_agent.as_deref(),
        Some(UA),
        "the proxy fetches audio with the UA of the client that minted the URL"
    );
}

// ---------------------------------------------------------------------------
// Dubbed-language selection
// ---------------------------------------------------------------------------

use flow_desktop_lib::api::innertube::extractors::player::select_playable_audio_tracks;

/// Real VISIONOS responses, with every signed URL replaced by a placeholder.
fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).expect("valid json")
}

/// The container half of a mime type, e.g. `audio/webm` out of
/// `audio/webm; codecs="opus"`.
fn container_of(mime: Option<&str>) -> String {
    mime.and_then(|mime| mime.split(';').next())
        .unwrap_or_default()
        .to_string()
}

#[test]
fn every_dubbed_language_is_offered_once() {
    let data = fixture("visionos_dubbed_streaming_data.json");
    let selected = select_playable_audio_tracks(&collect_audio_tracks(&data, UA));

    assert!(
        selected.len() > 15,
        "this response carries 20 languages, got {}",
        selected.len()
    );

    let mut languages: Vec<_> = selected
        .iter()
        .map(|track| {
            track
                .language_code
                .clone()
                .unwrap_or_else(|| track.label.clone())
        })
        .collect();
    let before = languages.len();
    languages.sort();
    languages.dedup();
    assert_eq!(
        before,
        languages.len(),
        "one entry per language, no duplicates"
    );
}

/// All alternates must share a container: the manifest declares them as sibling
/// AdaptationSets, and a container change forces the media engine to rebuild its
/// audio source buffer mid-stream.
#[test]
fn all_offered_languages_share_one_container() {
    let data = fixture("visionos_dubbed_streaming_data.json");
    let selected = select_playable_audio_tracks(&collect_audio_tracks(&data, UA));

    let mut containers: Vec<String> = selected
        .iter()
        .map(|track| container_of(track.mime_type.as_deref()))
        .collect();
    containers.sort();
    containers.dedup();
    assert_eq!(containers.len(), 1, "mixed containers: {containers:?}");
}

#[test]
fn the_original_track_leads_and_stays_default() {
    let data = fixture("visionos_dubbed_streaming_data.json");
    let selected = select_playable_audio_tracks(&collect_audio_tracks(&data, UA));

    assert!(selected[0].is_default, "the original sorts first");
    assert!(
        selected[0].label.contains("original"),
        "expected the original track, got {:?}",
        selected[0].label
    );
    assert_eq!(
        selected.iter().filter(|track| track.is_default).count(),
        1,
        "exactly one default across all languages"
    );
}

#[test]
fn every_offered_track_is_playable() {
    let data = fixture("visionos_dubbed_streaming_data.json");
    let selected = select_playable_audio_tracks(&collect_audio_tracks(&data, UA));

    for track in &selected {
        assert!(track.available, "{} must be selectable", track.label);
        assert!(!track.local_url.is_empty(), "{} needs a URL", track.label);
        // The synthetic DASH manifest needs SegmentBase ranges for every rung.
        assert!(
            track.init_range_start.is_some() && track.index_range_start.is_some(),
            "{} needs byte ranges to appear in the manifest",
            track.label
        );
    }
}

/// A video with no dubs must still resolve to exactly one playable track — this is
/// the shape that was playing silently before the default-flag fix.
#[test]
fn a_single_language_response_still_yields_one_track() {
    let data = fixture("visionos_single_language_streaming_data.json");
    let selected = select_playable_audio_tracks(&collect_audio_tracks(&data, UA));

    assert_eq!(selected.len(), 1, "no dubs means one track");
    assert!(selected[0].is_default);
    assert!(selected[0].available);
    assert!(selected[0].init_range_start.is_some());
}
