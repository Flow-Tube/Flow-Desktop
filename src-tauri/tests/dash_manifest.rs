//! Guards on the synthetic DASH manifest's audio contract.
//!
//! The player selects a dubbed language by matching the manifest's audio
//! AdaptationSets — by id, then `lang`, then label — and falls back to the set
//! tagged `Role=main` when nothing is chosen. These tests lock that shape, since a
//! manifest that drops a language or mislabels the original degrades silently:
//! playback keeps working, just with no way to reach the other languages.

use flow_desktop_lib::api::innertube::extractors::player::{
    collect_audio_tracks, select_playable_audio_tracks,
};
use flow_desktop_lib::commands::youtube::build_synthetic_dash_manifest;
use flow_desktop_lib::models::video::{StreamInfo, StreamVariant};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).expect("valid json")
}

fn video_variant(height: u64, bitrate: u64) -> StreamVariant {
    StreamVariant {
        id: format!("video-{height}"),
        local_url: format!("http://127.0.0.1:1/stream/video-{height}"),
        quality_label: format!("{height}p"),
        mime_type: Some("video/mp4; codecs=\"avc1.640028\"".to_string()),
        width: Some(height * 16 / 9),
        height: Some(height),
        fps: Some(30),
        bitrate: Some(bitrate),
        content_length: Some(1_000_000),
        is_default: height == 1080,
        is_playable: true,
        has_audio: false,
        is_video_only: true,
        delivery_method: "adaptive".to_string(),
        init_range_start: Some(0),
        init_range_end: Some(700),
        index_range_start: Some(701),
        index_range_end: Some(1200),
        approx_duration_ms: Some(300_000),
    }
}

fn stream_info_from(fixture_name: &str) -> StreamInfo {
    let data = fixture(fixture_name);
    let download_audio_tracks = collect_audio_tracks(&data, "test-agent");
    let audio_tracks = select_playable_audio_tracks(&download_audio_tracks);
    StreamInfo {
        stream_id: "test".to_string(),
        local_url: String::new(),
        expires_at: "21600".to_string(),
        variants: vec![video_variant(1080, 2_400_000), video_variant(360, 400_000)],
        captions: Vec::new(),
        audio_tracks,
        download_audio_tracks,
        hls_manifest_url: None,
        dash_manifest_url: None,
        is_live: false,
        sabr: None,
        sabr_descriptor: None,
    }
}

#[test]
fn every_language_becomes_its_own_adaptation_set() {
    let info = stream_info_from("visionos_dubbed_streaming_data.json");
    let languages = info.audio_tracks.len();
    let manifest = build_synthetic_dash_manifest(&info).expect("a manifest");

    let audio_sets = manifest.matches("contentType=\"audio\"").count();
    assert_eq!(
        audio_sets, languages,
        "every offered language must reach the manifest"
    );
    assert!(
        audio_sets > 15,
        "expected the full dub list, got {audio_sets}"
    );
}

#[test]
fn exactly_one_audio_set_is_tagged_main() {
    let info = stream_info_from("visionos_dubbed_streaming_data.json");
    let manifest = build_synthetic_dash_manifest(&info).expect("a manifest");

    assert_eq!(
        manifest.matches("value=\"main\"").count(),
        1,
        "the player falls back to the single Role=main set when nothing is selected"
    );
    // The original must be the one carrying it, and it must come first.
    let main_at = manifest.find("value=\"main\"").expect("a main role");
    let first_alternate = manifest.find("value=\"alternate\"");
    assert!(
        first_alternate.is_none_or(|alternate| main_at < alternate),
        "the original audio must precede the dubs"
    );
}

#[test]
fn each_audio_set_carries_a_language_and_a_unique_id() {
    let info = stream_info_from("visionos_dubbed_streaming_data.json");
    let manifest = build_synthetic_dash_manifest(&info).expect("a manifest");

    let mut ids: Vec<&str> = manifest
        .match_indices("<AdaptationSet id=\"audio-")
        .map(|(index, _)| {
            let rest = &manifest[index + "<AdaptationSet id=\"".len()..];
            &rest[..rest.find('"').expect("closing quote")]
        })
        .collect();
    let total = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(total, ids.len(), "AdaptationSet ids must be unique");

    // `lang="und"` would leave the player unable to match a track by language.
    assert!(
        !manifest.contains("contentType=\"audio\" lang=\"und\""),
        "dubbed sets must declare their language"
    );
}

#[test]
fn a_single_language_video_still_produces_a_manifest() {
    let info = stream_info_from("visionos_single_language_streaming_data.json");
    let manifest = build_synthetic_dash_manifest(&info).expect("a manifest");

    assert_eq!(manifest.matches("contentType=\"audio\"").count(), 1);
    assert_eq!(manifest.matches("value=\"main\"").count(), 1);
    assert!(manifest.contains("contentType=\"video\""));
}
