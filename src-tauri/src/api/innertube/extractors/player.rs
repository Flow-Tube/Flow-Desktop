use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::botguard::generate_po_token;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::gate_tracker::gated_last;
use crate::api::innertube::core::playback_session::{
    new_cpn, take_reload_token, with_session_params,
};
use crate::api::innertube::core::player_js;
use crate::api::innertube::core::player_requests::{PlaybackPriority, PlayerFlights};
use crate::api::innertube::core::remote_decoder;
use crate::api::innertube::core::utils::watch_next_body;
use crate::api::innertube::extractors::playability::{
    LadderReport, Refusal, check_playability_status, ends_the_ladder, is_better_report,
    is_bot_wall, map_playability_error,
};
use crate::api::innertube::extractors::watch_next;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::thumbnail_url_from_array;
use crate::api::innertube::json::xtags::decode_xtags;
use crate::errors::{AppError, AppResult};
use crate::models::video::{
    AudioTrack, CaptionTrack, RelatedPage, SabrStreamInfo, StreamInfo, StreamVariant, VideoBasics,
    VideoDetails,
};
use crate::streaming::sabr::engine::decode_b64_loose;
use crate::streaming::sabr::selector::{CodecSupport, SabrFormat, select_formats};
use crate::streaming::sabr::{ClientProfile, SabrSessionDescriptor};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

/// How long any single client gets before the ladder moves on. A stuck client
/// must not hold up first frame when the next one down would have answered.
const PER_CLIENT_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(6000);

/// How long a resolved `player` response stays reusable.
///
/// Opening one video asks for the same response more than once: playback
/// resolves it, the metadata around the player asks again, and the prefetch
/// fired on click makes a third. The URLs it carries stay valid for hours, so a
/// window this short only ever collapses the requests belonging to a single
/// open — it is not a content cache.
const PLAYER_RESPONSE_TTL: Duration = Duration::from_secs(120);

/// Cap on retained responses. A player response is a large JSON document and
/// nothing beyond the few videos currently in flight is ever asked for again.
const PLAYER_RESPONSE_CACHE_CAPACITY: usize = 12;

/// How long video details wait for the `next` response (likes, views, publish
/// date) before returning without them.

/// Web clients mint a PO token and solve `n` before their SABR session can
/// start, so they get the longer budget Flow for Android gives them.
const WEB_PLAYER_TIMEOUT: Duration = Duration::from_secs(10);

/// Client ladder for playback, in Flow for Android's order.
///
/// 1. `VISIONOS`: direct URLs with neither a PO token nor an `n` parameter, so it
///    reaches first frame fastest. It needs `visitorData` on the request; without
///    it the answer is a bot wall.
/// 2. `MWEB`, then `WEB`: a `BotGuard` token on the request buys a SABR session, which
///    is playable once its endpoint's `n` is solved from the player script.
/// 3. The `ANDROID_VR` builds, newest first: unattested direct URLs that still
///    answer some videos the others are walled on, though googlevideo can stop
///    serving them partway in.
/// 4. `ANDROID`: last resort. It usually answers with ciphered formats only, which
///    the playability check below skips without paying for them.
const PLAYER_CLIENT_LADDER: &[&clients::YouTubeClient] = &[
    &clients::VISIONOS,
    &clients::MWEB,
    &clients::WEB,
    // Past the walls the gated clients below stop at a minute, and the source
    // for label and kids videos the app clients refuse (Flow for Android #921, #1292).
    &clients::TV_TIZEN,
    &clients::ANDROID_VR_1_65_10,
    &clients::ANDROID_VR,
    &clients::ANDROID_VR_NO_AUTH,
    &clients::ANDROID_VR_1_43_32,
    &clients::ANDROID,
];

/// A direct ladder that tops out below this height likely has its higher rungs
/// served only over SABR, so the web clients are asked too (Flow for Android's
/// `SabrRoutingPolicy`).
const SABR_UPGRADE_FLOOR: u64 = 720;
/// How long a playable direct answer waits on that upgrade before it is used
/// as it is: the upgrade mints a token and may fetch the player script first.
const SABR_UPGRADE_BUDGET: Duration = Duration::from_secs(3);
const SABR_UPGRADE_CLIENTS: &[&clients::YouTubeClient] = &[&clients::MWEB, &clients::WEB];

/// Clients asked for a live broadcast's HLS/DASH manifest when the winning
/// client returned none. A live stream plays from its manifest, so this only
/// needs a client that exposes one, not one with a usable direct ladder.
const LIVE_MANIFEST_CLIENTS: &[&clients::YouTubeClient] =
    &[&clients::ANDROID_VR_1_65_10, &clients::VISIONOS];

/// The winning client of a ladder walk, plus what it was attested with.
#[derive(Clone)]
struct PlayerAttempt {
    response: Value,
    client: &'static clients::YouTubeClient,
    po_token: Option<String>,
    /// The visitor identity the response was issued to; a SABR session must
    /// present the same one.
    visitor_data: Option<String>,
}

struct CachedPlayerAttempt {
    attempt: PlayerAttempt,
    resolved_at: Instant,
}

pub(crate) fn playback_priority() -> &'static PlaybackPriority {
    static PRIORITY: OnceLock<PlaybackPriority> = OnceLock::new();
    PRIORITY.get_or_init(PlaybackPriority::default)
}

/// Successful ladder walks, keyed by video id. Only an `OK` response is stored,
/// so a restricted or unplayable video always walks the ladder again and keeps
/// reporting its own `AppError` variant rather than a cached generic failure.
fn player_response_cache() -> &'static Mutex<HashMap<String, CachedPlayerAttempt>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedPlayerAttempt>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_player_attempt(video_id: &str) -> Option<PlayerAttempt> {
    let mut cache = player_response_cache().lock().ok()?;
    let entry = cache.get(video_id)?;
    if entry.resolved_at.elapsed() >= PLAYER_RESPONSE_TTL {
        cache.remove(video_id);
        return None;
    }
    Some(entry.attempt.clone())
}

fn store_player_attempt(video_id: &str, attempt: &PlayerAttempt) {
    let Ok(mut cache) = player_response_cache().lock() else {
        return;
    };
    cache.retain(|_, entry| entry.resolved_at.elapsed() < PLAYER_RESPONSE_TTL);
    if cache.len() >= PLAYER_RESPONSE_CACHE_CAPACITY {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.resolved_at)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&oldest);
        }
    }
    cache.insert(
        video_id.to_string(),
        CachedPlayerAttempt {
            attempt: attempt.clone(),
            resolved_at: Instant::now(),
        },
    );
}

fn invalidate_player_response(video_id: &str) {
    if let Ok(mut cache) = player_response_cache().lock() {
        cache.remove(video_id);
    }
}

fn check_needs_reload(val: &Value) -> bool {
    if let Some(status) = val["playabilityStatus"]["status"].as_str() {
        if status
            .to_ascii_lowercase()
            .contains("page needs to be reloaded")
        {
            return true;
        }
    }
    if let Some(reason) = val["playabilityStatus"]["reason"].as_str() {
        if reason
            .to_ascii_lowercase()
            .contains("page needs to be reloaded")
        {
            return true;
        }
    }
    false
}

fn validate_stream_url(stream_url: &str, video_id: &str) -> AppResult<String> {
    let parsed_url = reqwest::Url::parse(stream_url).map_err(|error| {
        AppError::Extractor(format!(
            "Failed to parse extracted stream URL for video {video_id}: {error}"
        ))
    })?;

    let has_throttling_parameter = parsed_url
        .query_pairs()
        .any(|(key, value)| key == "n" && !value.is_empty())
        && !remote_decoder::was_solved(stream_url);

    if has_throttling_parameter {
        return Err(AppError::Extractor(format!(
            "Stream URL for video {video_id} still requires throttling parameter deobfuscation"
        )));
    }

    Ok(parsed_url.into())
}

fn extract_stream_url_from_format(format: &Value, video_id: &str) -> AppResult<Option<String>> {
    if let Some(url) = format["url"].as_str() {
        return validate_stream_url(url, video_id).map(Some);
    }

    let Some(cipher_string) = format["cipher"]
        .as_str()
        .or_else(|| format["signatureCipher"].as_str())
    else {
        return Ok(None);
    };

    let query_url = reqwest::Url::parse(&format!("https://example.invalid/?{cipher_string}"))
        .map_err(|error| {
            AppError::Extractor(format!(
                "Failed to parse stream cipher for video {video_id}: {error}"
            ))
        })?;

    let mut base_url = None;
    let mut signature_parameter = None;
    let mut direct_signature = None;
    let mut encrypted_signature = None;

    for (key, value) in query_url.query_pairs() {
        match key.as_ref() {
            "url" => base_url = Some(value.into_owned()),
            "sp" => signature_parameter = Some(value.into_owned()),
            "sig" | "signature" => direct_signature = Some(value.into_owned()),
            "s" => encrypted_signature = Some(value.into_owned()),
            _ => {}
        }
    }

    let Some(base_url) = base_url else {
        return Err(AppError::Extractor(format!(
            "Cipher-protected format for video {video_id} is missing its base URL"
        )));
    };

    if let Some(signature) = direct_signature {
        let parameter_name = signature_parameter.unwrap_or_else(|| "signature".to_string());
        let mut parsed_url = reqwest::Url::parse(&base_url).map_err(|error| {
            AppError::Extractor(format!(
                "Failed to parse signed stream URL for video {video_id}: {error}"
            ))
        })?;

        parsed_url
            .query_pairs_mut()
            .append_pair(&parameter_name, &signature);

        return validate_stream_url(parsed_url.as_ref(), video_id).map(Some);
    }

    if encrypted_signature.is_some() {
        return Err(AppError::Extractor(format!(
            "Cipher-protected stream for video {video_id} still requires signature deobfuscation"
        )));
    }

    validate_stream_url(&base_url, video_id).map(Some)
}

/// The tallest video format a response lists, URL or not: a SABR answer lists
/// its formats without URLs.
fn max_video_height(streaming_data: &Value) -> u64 {
    ["formats", "adaptiveFormats"]
        .iter()
        .filter_map(|key| streaming_data[*key].as_array())
        .flatten()
        .filter(|format| {
            format["mimeType"]
                .as_str()
                .is_some_and(|mime| mime.starts_with("video/"))
        })
        .filter_map(quality_height)
        .max()
        .unwrap_or(0)
}

fn quality_height(format: &Value) -> Option<u64> {
    format["height"].as_u64().or_else(|| {
        format["qualityLabel"].as_str().and_then(|label| {
            let digits = label
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>();
            digits.parse::<u64>().ok()
        })
    })
}

fn parse_range_value(range: &Value) -> (Option<u64>, Option<u64>) {
    (
        range["start"]
            .as_str()
            .and_then(|value| value.parse::<u64>().ok()),
        range["end"]
            .as_str()
            .and_then(|value| value.parse::<u64>().ok()),
    )
}

fn parse_approx_duration_ms(format: &Value) -> Option<u64> {
    format["approxDurationMs"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
}

fn parse_content_length(format: &Value) -> Option<u64> {
    format["contentLength"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| format["contentLength"].as_u64())
}

fn append_or_replace_query_param(raw_url: &str, key: &str, value: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(raw_url).ok()?;
    let query_pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(existing_key, _)| existing_key != key)
        .map(|(existing_key, existing_value)| {
            (existing_key.into_owned(), existing_value.into_owned())
        })
        .collect();
    url.query_pairs_mut()
        .clear()
        .extend_pairs(query_pairs)
        .append_pair(key, value);
    Some(url.to_string())
}

fn caption_url(base_url: &str, translated_language_code: Option<&str>) -> Option<String> {
    let url = if let Some(language_code) = translated_language_code {
        append_or_replace_query_param(base_url, "tlang", language_code)?
    } else {
        base_url.to_string()
    };
    append_or_replace_query_param(&url, "fmt", "vtt")
}

fn format_is_video(format: &Value) -> bool {
    format["mimeType"]
        .as_str()
        .map(|mime| mime.starts_with("video/"))
        .unwrap_or(false)
        && format["qualityLabel"].as_str().is_some()
}

fn build_stream_variant_from_format(
    format: &Value,
    video_id: &str,
    is_progressive: bool,
) -> AppResult<Option<StreamVariant>> {
    if !format_is_video(format) {
        return Ok(None);
    }

    let itag = format["itag"]
        .as_i64()
        .map(|value| value.to_string())
        .unwrap_or_else(|| format["quality"].as_str().unwrap_or("unknown").to_string());
    let height = quality_height(format);
    let quality_label = format["qualityLabel"]
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| height.map(|h| format!("{h}p")))
        .unwrap_or_else(|| "Auto".to_string());

    let local_url = extract_stream_url_from_format(format, video_id)?.unwrap_or_default();
    let is_playable = !local_url.is_empty();
    let (init_range_start, init_range_end) = parse_range_value(&format["initRange"]);
    let (index_range_start, index_range_end) = parse_range_value(&format["indexRange"]);

    Ok(Some(StreamVariant {
        id: itag,
        local_url,
        quality_label,
        mime_type: format["mimeType"].as_str().map(ToOwned::to_owned),
        width: format["width"].as_u64(),
        height,
        fps: format["fps"].as_u64(),
        bitrate: format["bitrate"].as_u64(),
        content_length: parse_content_length(format),
        is_default: false,
        is_playable,
        has_audio: is_progressive,
        is_video_only: !is_progressive,
        delivery_method: if is_progressive {
            "progressive"
        } else {
            "adaptive"
        }
        .to_string(),
        init_range_start,
        init_range_end,
        index_range_start,
        index_range_end,
        approx_duration_ms: parse_approx_duration_ms(format),
    }))
}

fn collect_stream_variants(
    streaming_data: &Value,
    video_id: &str,
) -> (Vec<StreamVariant>, Option<AppError>) {
    let mut variants = Vec::new();
    let mut last_error = None;

    if let Some(formats) = streaming_data["formats"].as_array() {
        for format in formats {
            match build_stream_variant_from_format(format, video_id, true) {
                Ok(Some(variant)) => variants.push(variant),
                Ok(None) => {}
                Err(error) => last_error = Some(error),
            }
        }
    }

    if let Some(adaptive_formats) = streaming_data["adaptiveFormats"].as_array() {
        for format in adaptive_formats {
            if format_is_video(format) {
                match build_stream_variant_from_format(format, video_id, false) {
                    Ok(Some(variant)) => variants.push(variant),
                    Ok(None) => {}
                    Err(error) => last_error = Some(error),
                }
            }
        }
    }

    variants.sort_by(|a, b| {
        b.height
            .unwrap_or(0)
            .cmp(&a.height.unwrap_or(0))
            .then_with(|| b.is_playable.cmp(&a.is_playable))
            .then_with(|| b.bitrate.unwrap_or(0).cmp(&a.bitrate.unwrap_or(0)))
    });

    let mut seen = std::collections::HashSet::new();
    variants.retain(|variant| {
        let key = format!(
            "{}:{}:{}:{}:{}",
            variant.quality_label,
            variant.fps.unwrap_or(0),
            variant.is_playable,
            variant.mime_type.as_deref().unwrap_or_default(),
            variant.delivery_method,
        );
        seen.insert(key)
    });

    if let Some(default_index) = variants.iter().position(|variant| variant.is_playable) {
        if let Some(default) = variants.get_mut(default_index) {
            default.is_default = true;
        }
    }

    (variants, last_error)
}

fn collect_caption_tracks(response: &Value) -> Vec<CaptionTrack> {
    let renderer = &response["captions"]["playerCaptionsTracklistRenderer"];
    let Some(tracks) = renderer["captionTracks"].as_array() else {
        return Vec::new();
    };

    let mut captions = Vec::new();
    let mut native_language_codes = HashSet::new();

    for (index, track) in tracks.iter().enumerate() {
        let Some(base_url) = track["baseUrl"].as_str() else {
            continue;
        };
        let language_code = track["languageCode"].as_str().unwrap_or("und").to_string();
        native_language_codes.insert(language_code.clone());
        let label = text_of(&track["name"]).unwrap_or_else(|| language_code.clone());
        let vss_id = track["vssId"].as_str().unwrap_or_default();
        let is_auto_generated = vss_id.starts_with("a.")
            || track["kind"]
                .as_str()
                .map(|kind| kind.eq_ignore_ascii_case("asr"))
                .unwrap_or(false);
        let Some(url) = caption_url(base_url, None) else {
            continue;
        };

        captions.push(CaptionTrack {
            id: format!("caption-{index}-{language_code}"),
            label,
            language_code,
            url,
            is_auto_generated,
            is_translation: false,
        });
    }

    // Translate from an authored track when there is one: a translation of the
    // speech-recognition track carries every recognition error into the target.
    let translatable_track = tracks
        .iter()
        .filter(|track| {
            track["isTranslatable"].as_bool().unwrap_or(false)
                && track["baseUrl"].as_str().is_some()
        })
        .min_by_key(|track| {
            track["kind"].as_str() == Some("asr")
                || track["vssId"]
                    .as_str()
                    .is_some_and(|id| id.starts_with("a."))
        });

    if let Some(track) = translatable_track {
        let base_url = track["baseUrl"].as_str().unwrap_or_default();
        if let Some(translation_languages) = renderer["translationLanguages"].as_array() {
            let mut seen_translations = HashSet::new();
            for language in translation_languages {
                let Some(language_code) = language["languageCode"].as_str() else {
                    continue;
                };
                if native_language_codes.contains(language_code)
                    || !seen_translations.insert(language_code.to_string())
                {
                    continue;
                }
                let Some(url) = caption_url(base_url, Some(language_code)) else {
                    continue;
                };
                let label =
                    text_of(&language["languageName"]).unwrap_or_else(|| language_code.to_string());

                captions.push(CaptionTrack {
                    id: format!("caption-translated-{language_code}"),
                    label,
                    language_code: language_code.to_string(),
                    url,
                    is_auto_generated: true,
                    is_translation: true,
                });
            }
        }
    }

    captions
}

// Build the audio track list from a player response's `adaptiveFormats`. The PO
// token is never appended to these GVS media URLs (it belongs only on the player
// request body and the SABR `StreamerContext`); a stale/wrong `&pot=` 403s.
/// One audio format plus the signals used to choose between duplicates of it.
///
/// Needed because a client can return the same itag more than once: VISIONOS
/// ships a plain copy and an `xtags`-tagged variant (descriptive/dubbed content)
/// of every audio itag, and both carry identical identity fields, so they collide
/// on the same dedup key.
struct AudioCandidate {
    track: AudioTrack,
    /// `audioIsDefault` as the response stated it, if it stated anything at all.
    declared_default: Option<bool>,
    is_auto_dubbed: bool,
    /// The dynamic-range compressed copy (`xtags` `drc=1` or `isDrc`).
    is_drc: bool,
    has_xtags: bool,
}

impl AudioCandidate {
    /// Preference order between two formats that share an identity key, best last.
    ///
    /// The normal copy outranks its DRC twin, whose bitrate differs by a few
    /// bytes a second, so bitrate alone picked the loudness-flattened one. A
    /// plain twin then outranks a tagged one: googlevideo refused sustained
    /// playback on some tagged variants, so a higher bitrate there bought a
    /// stream that died partway in.
    fn rank(&self) -> (bool, bool, bool, bool, u64) {
        (
            !self.is_drc,
            self.declared_default.unwrap_or(false),
            !self.is_auto_dubbed,
            !self.has_xtags,
            self.track.bitrate.unwrap_or(0),
        )
    }
}

/// The `audio_track_type` an `xtags` `acont` names, when it names one.
fn track_type_from_acont(acont: &str) -> Option<&'static str> {
    match acont {
        "original" => Some("original"),
        "dubbed" => Some("dubbed"),
        "dubbed-auto" => Some("dubbed-auto"),
        _ => None,
    }
}

/// Resolve the audio tracks a player response offers, one per audio identity.
///
/// Public so `tests/audio_tracks.rs` can exercise the duplicate-resolution rules
/// against real response shapes; nothing outside extraction calls it.
pub fn collect_audio_tracks(streaming_data: &Value, user_agent: &str) -> Vec<AudioTrack> {
    let mut candidates_by_key: HashMap<String, AudioCandidate> = HashMap::new();

    if let Some(adaptive_formats) = streaming_data["adaptiveFormats"].as_array() {
        for format in adaptive_formats {
            let Some(mime) = format["mimeType"].as_str() else {
                continue;
            };
            if !mime.starts_with("audio/") {
                continue;
            }

            let audio_track = &format["audioTrack"];
            let itag = format["itag"]
                .as_i64()
                .map(|itag| itag.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let id = audio_track["id"]
                .as_str()
                .map(ToOwned::to_owned)
                .or_else(|| format["itag"].as_i64().map(|itag| format!("itag-{itag}")))
                .unwrap_or_else(|| "default".to_string());
            let language_code = audio_track_language_code(audio_track, &id);
            let label = audio_track["displayName"]
                .as_str()
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .or_else(|| language_code.clone())
                .unwrap_or_else(|| "Original audio".to_string());
            let local_url = match extract_stream_url_from_format(format, "audio-track") {
                Ok(Some(url)) => url,
                Ok(None) => continue,
                Err(_) => continue,
            };

            let bitrate = format["bitrate"]
                .as_u64()
                .or_else(|| format["averageBitrate"].as_u64());
            let (init_range_start, init_range_end) = parse_range_value(&format["initRange"]);
            let (index_range_start, index_range_end) = parse_range_value(&format["indexRange"]);
            let is_auto_dubbed = audio_track["isAutoDubbed"].as_bool().unwrap_or(false);
            // Only the response's own claim — never position in the list. Deriving
            // it positionally meant the flag could be silently dropped when a later
            // duplicate replaced the entry holding it, leaving no default at all.
            let declared_default = audio_track["audioIsDefault"].as_bool();
            let raw_xtags = format["xtags"].as_str().filter(|value| !value.is_empty());
            let has_xtags = raw_xtags.is_some();
            let xtags = raw_xtags.map(decode_xtags).unwrap_or_default();
            let is_drc = format["isDrc"].as_bool().unwrap_or(false)
                || xtags.get("drc").is_some_and(|value| value == "1");
            let tagged_type = xtags
                .get("acont")
                .and_then(|acont| track_type_from_acont(acont));
            let is_default = declared_default.unwrap_or(false);
            let mime_type = format["mimeType"].as_str().map(ToOwned::to_owned);
            let track_key = audio_track_identity_key(
                audio_track,
                &id,
                language_code.as_deref(),
                mime_type.as_deref(),
            );
            let candidate = AudioCandidate {
                track: AudioTrack {
                    id: format!("{id}-{itag}"),
                    label,
                    language_code,
                    audio_track_type: Some(
                        tagged_type
                            .unwrap_or(if is_default { "original" } else { "alternate" })
                            .to_string(),
                    ),
                    local_url,
                    mime_type,
                    bitrate,
                    content_length: parse_content_length(format),
                    is_default,
                    available: is_default,
                    init_range_start,
                    init_range_end,
                    index_range_start,
                    index_range_end,
                    approx_duration_ms: parse_approx_duration_ms(format),
                    user_agent: Some(user_agent.to_string()),
                },
                declared_default,
                is_auto_dubbed,
                is_drc,
                has_xtags,
            };

            match candidates_by_key.get(&track_key) {
                Some(existing) if existing.rank() >= candidate.rank() => {}
                _ => {
                    candidates_by_key.insert(track_key, candidate);
                }
            }
        }
    }

    let mut candidates: Vec<AudioCandidate> = candidates_by_key.into_values().collect();
    candidates.sort_by(|a, b| b.rank().cmp(&a.rank()));

    // Many responses never flag a default at all — VISIONOS omits `audioTrack`
    // entirely on videos with no dubs. Promote the best candidate rather than
    // returning a list with no default: `build_synthetic_dash_manifest` selects on
    // that flag, and with nothing marked it emits no manifest, which degrades
    // playback to a video-only stream with no audio at all.
    if !candidates
        .iter()
        .any(|candidate| candidate.track.is_default)
    {
        if let Some(best) = candidates.first_mut() {
            best.track.is_default = true;
            best.track.available = true;
            best.track.audio_track_type = Some("original".to_string());
        }
    }

    let mut tracks: Vec<AudioTrack> = candidates
        .into_iter()
        .map(|candidate| candidate.track)
        .collect();
    tracks.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| b.bitrate.unwrap_or(0).cmp(&a.bitrate.unwrap_or(0)))
    });

    tracks
}

pub fn select_playable_audio_tracks(tracks: &[AudioTrack]) -> Vec<AudioTrack> {
    let language_key = |track: &AudioTrack| -> String {
        track
            .language_code
            .clone()
            .unwrap_or_else(|| track.label.clone())
    };
    let container = |track: &AudioTrack| -> String {
        track
            .mime_type
            .as_deref()
            .and_then(|mime| mime.split(';').next())
            .unwrap_or_default()
            .to_string()
    };

    // What the original track resolves to when it is the only one considered.
    let preferred_container = tracks
        .iter()
        .filter(|track| track.is_default)
        .max_by_key(|track| track.bitrate.unwrap_or(0))
        .map(container);

    let mut by_language: Vec<(String, AudioTrack)> = Vec::new();
    for track in tracks {
        let key = language_key(track);
        let in_preferred_container = preferred_container
            .as_ref()
            .is_none_or(|preferred| container(track) == *preferred);
        // (container matches, bitrate) — a language that cannot offer the shared
        // container still gets its best format rather than vanishing from the menu.
        let rank = (in_preferred_container, track.bitrate.unwrap_or(0));

        match by_language
            .iter_mut()
            .find(|(existing, _)| *existing == key)
        {
            Some((_, existing)) => {
                let existing_rank = (
                    preferred_container
                        .as_ref()
                        .is_none_or(|preferred| container(existing) == *preferred),
                    existing.bitrate.unwrap_or(0),
                );
                if rank > existing_rank {
                    *existing = track.clone();
                }
            }
            None => by_language.push((key, track.clone())),
        }
    }

    let mut selected: Vec<AudioTrack> = by_language
        .into_iter()
        .map(|(_, track)| track)
        .map(|mut track| {
            // Every surviving track carries a direct URL that googlevideo serves,
            // so all of them are offerable; `available` only ever marks a track the
            // player must refuse.
            track.available = true;
            track
        })
        .collect();

    selected.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.label.cmp(&b.label))
    });

    selected
}

fn audio_track_language_code(audio_track: &Value, id: &str) -> Option<String> {
    if let Some(language_code) = audio_track["languageCode"]
        .as_str()
        .filter(|value| !value.is_empty())
    {
        return Some(language_code.to_string());
    }

    let suffix = id
        .rsplit_once('_')
        .map(|(_, suffix)| suffix)
        .filter(|value| looks_like_language_code(value));
    if let Some(language_code) = suffix {
        return Some(language_code.to_string());
    }

    let prefix = id
        .split_once('.')
        .map(|(prefix, _)| prefix)
        .filter(|value| looks_like_language_code(value));
    if let Some(language_code) = prefix {
        return Some(language_code.to_string());
    }

    id.rsplit_once('.')
        .map(|(_, suffix)| suffix)
        .filter(|value| looks_like_language_code(value))
        .map(ToOwned::to_owned)
}

fn audio_track_identity_key(
    audio_track: &Value,
    id: &str,
    language_code: Option<&str>,
    mime_type: Option<&str>,
) -> String {
    let identity = audio_track["displayName"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(|value| format!("name:{value}"))
        .or_else(|| language_code.map(|value| format!("lang:{value}")))
        .unwrap_or_else(|| format!("id:{id}"));
    format!("{identity}|{}", mime_type.unwrap_or_default())
}

fn looks_like_language_code(value: &str) -> bool {
    (2..=12).contains(&value.len())
        && value
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == '-' || c == '_')
        && value.chars().any(|c| c.is_ascii_alphabetic())
}

fn extract_duration_seconds_from_player_response(response: &Value) -> Option<u64> {
    response["videoDetails"]["lengthSeconds"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| {
            response["microformat"]["playerMicroformatRenderer"]["lengthSeconds"]
                .as_str()
                .and_then(|value| value.parse::<u64>().ok())
        })
        .or_else(|| {
            response["streamingData"]["adaptiveFormats"]
                .as_array()
                .and_then(|formats| formats.first())
                .and_then(|format| format["approxDurationMs"].as_str())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|duration_ms| duration_ms / 1000)
        })
}

// ---------------------------------------------------------------------------
// SABR metadata extraction
// ---------------------------------------------------------------------------

fn parse_sabr_formats(streaming_data: &Value) -> Vec<SabrFormat> {
    let mut formats = Vec::new();
    let Some(adaptive) = streaming_data["adaptiveFormats"].as_array() else {
        return formats;
    };
    for format in adaptive {
        let Some(itag) = format["itag"].as_i64() else {
            continue;
        };
        let mime_type = format["mimeType"].as_str().unwrap_or_default().to_string();
        if mime_type.is_empty() {
            continue;
        }
        let is_audio = mime_type.starts_with("audio/");
        let last_modified = format["lastModified"]
            .as_str()
            .and_then(|v| v.parse::<u64>().ok())
            .or_else(|| format["lastModified"].as_u64())
            .unwrap_or(0);
        let xtags = format["xtags"].as_str().map(ToOwned::to_owned);
        let bitrate = format["bitrate"]
            .as_u64()
            .or_else(|| format["averageBitrate"].as_u64())
            .unwrap_or(0);
        let approx_duration_ms = format["approxDurationMs"]
            .as_str()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        let audio_track = &format["audioTrack"];
        let audio_track_id = audio_track["id"].as_str().map(ToOwned::to_owned);
        let audio_track_name = audio_track["displayName"].as_str().map(ToOwned::to_owned);
        let audio_is_default = audio_track["audioIsDefault"]
            .as_bool()
            .unwrap_or(audio_track.is_null() && is_audio);

        formats.push(SabrFormat {
            itag: itag as i32,
            last_modified,
            xtags,
            mime_type,
            bitrate,
            width: format["width"].as_u64().unwrap_or(0),
            height: format["height"].as_u64().unwrap_or(0),
            fps: format["fps"].as_u64().unwrap_or(0),
            approx_duration_ms,
            is_audio,
            audio_track_id,
            audio_track_name,
            audio_is_default,
        });
    }
    formats
}

// `streamingData.serverAbrStreamingUrl`, if present and non-empty.
fn extract_server_abr_url(streaming_data: &Value) -> Option<String> {
    streaming_data["serverAbrStreamingUrl"]
        .as_str()
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

// Decode `playerConfig.mediaCommonConfig.mediaUstreamerRequestConfig
// .videoPlaybackUstreamerConfig` (URL-safe base64) into raw protobuf bytes.
fn extract_ustreamer_config(res: &Value) -> Vec<u8> {
    res["playerConfig"]["mediaCommonConfig"]["mediaUstreamerRequestConfig"]
        ["videoPlaybackUstreamerConfig"]
        .as_str()
        .filter(|v| !v.is_empty())
        .and_then(decode_b64_loose)
        .unwrap_or_default()
}

// Build the frontend-facing `SabrStreamInfo` and the internal session
// descriptor from a successful player response. Returns `(None, None)` when no
// SABR metadata is present at all.
fn build_sabr_metadata(
    res: &Value,
    streaming_data: &Value,
    video_id: &str,
    visitor_data: Option<String>,
    po_token: Option<String>,
    client: &clients::YouTubeClient,
    duration_seconds: Option<u64>,
) -> (Option<SabrStreamInfo>, Option<SabrSessionDescriptor>) {
    let server_url = extract_server_abr_url(streaming_data);
    let formats = parse_sabr_formats(streaming_data);
    let ustreamer_config = extract_ustreamer_config(res);

    let has_audio = formats.iter().any(|f| f.is_audio);
    let has_video = formats.iter().any(|f| !f.is_audio);
    let selectable = select_formats(&formats, None, CodecSupport::default());

    // Observability: one structured line capturing SABR-capability inputs.
    info!(
        video_id = %video_id,
        client = %client.name,
        sabr_url_present = server_url.is_some(),
        ustreamer_config_present = !ustreamer_config.is_empty(),
        po_token_present = po_token.is_some(),
        adaptive_format_count = formats.len(),
        has_audio,
        has_video,
        selectable = selectable.is_some(),
        "sabr_capability_probe"
    );

    // No SABR endpoint at all: nothing to expose.
    let Some(server_url) = server_url else {
        return (None, None);
    };

    let has_po_token = po_token.as_deref().map(|t| !t.is_empty()).unwrap_or(false);
    let has_visitor_data = visitor_data
        .as_deref()
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let requires_po_token = !has_po_token;
    let (selected_audio_itag, selected_video_itag) = match &selectable {
        Some(sel) => (Some(sel.audio.itag), Some(sel.video.itag)),
        None => (None, None),
    };

    let available =
        has_audio && has_video && selectable.is_some() && has_po_token && has_visitor_data;
    let reason_unavailable = if available {
        None
    } else if !has_po_token {
        Some("SABR requires a PO token, which is unavailable for this client".to_string())
    } else if !has_visitor_data {
        Some("SABR requires visitor data, which is unavailable".to_string())
    } else if !has_audio || !has_video {
        Some("missing audio or video adaptive formats".to_string())
    } else {
        Some("no playable format pair under codec constraints".to_string())
    };

    let duration_ms = duration_seconds
        .map(|s| s * 1000)
        .or_else(|| {
            formats
                .iter()
                .map(|f| f.approx_duration_ms)
                .filter(|d| *d > 0)
                .max()
        })
        .unwrap_or(0);

    let info = SabrStreamInfo {
        available,
        manifest_url: None,
        audio_url: None,
        video_url: None,
        selected_audio_itag,
        selected_video_itag,
        expires_in_seconds: streaming_data["expiresInSeconds"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok()),
        requires_po_token,
        reason_unavailable,
    };

    let descriptor = if available {
        Some(SabrSessionDescriptor {
            video_id: video_id.to_string(),
            server_abr_streaming_url: server_url,
            visitor_data,
            po_token,
            ustreamer_config,
            client_profile: ClientProfile::from_client(client),
            duration_ms,
            formats,
        })
    } else {
        None
    };

    (Some(info), descriptor)
}

/// What one client's `player` request came back with.
enum ClientOutcome {
    /// Playable, with streams Flow can actually fetch.
    Won(PlayerAttempt),
    /// A non-OK playability status, kept so the most specific restriction can be
    /// reported once the ladder is exhausted.
    Refused(Refusal),
    /// No answer, or an `OK` with nothing fetchable (ciphered-only formats, an
    /// unsolvable `n`, a missing PO token).
    Unusable,
}

/// Whether a direct-URL response carries a stream the proxy can fetch as is:
/// a muxed format, or a video-only one with a separate audio track beside it.
fn has_playable_direct_streams(streaming_data: &Value, video_id: &str) -> bool {
    let (variants, _) = collect_stream_variants(streaming_data, video_id);
    let has_separate_audio = !collect_audio_tracks(streaming_data, "").is_empty();
    variants
        .iter()
        .any(|variant| variant.is_playable && (variant.has_audio || has_separate_audio))
}

/// How long googlevideo holds a response's streams behind its pre-roll: an
/// answer with a start ad is refused on every byte until about 0.8 of the ad's
/// skip offset has passed, at most 8 seconds (measured by Flow for Android on
/// `TV_TIZEN`).
fn preroll_wait(ad_placements: &Value) -> Duration {
    const MAX_MS: u64 = 8_000;
    ad_placements
        .as_array()
        .into_iter()
        .flatten()
        .map(|placement| &placement["adPlacementRenderer"])
        .filter(|renderer| {
            renderer["config"]["adPlacementConfig"]["kind"] == "AD_PLACEMENT_KIND_START"
        })
        .map(|renderer| {
            let offset = &renderer["renderer"]["instreamVideoAdRenderer"]["skipOffsetMilliseconds"];
            offset
                .as_u64()
                .or_else(|| offset.as_str().and_then(|value| value.parse().ok()))
                .map_or(MAX_MS, |ms| ms * 4 / 5)
        })
        .max()
        .map_or(Duration::ZERO, |ms| Duration::from_millis(ms.min(MAX_MS)))
}

/// Rewrite every format of `response` into a URL googlevideo serves: signed
/// formats get their solved signature, and every URL its `n` solved, both by the
/// remote decoder. A format either step could not solve is left as it was, which
/// the stream collector then skips.
async fn solve_formats(response: &mut Value, player: &remote_decoder::DecoderPlayer) {
    let streaming = &mut response["streamingData"];
    let formats = || {
        ["formats", "adaptiveFormats"]
            .iter()
            .filter_map(|key| streaming[*key].as_array())
            .flatten()
    };
    let signatures: Vec<String> = formats()
        .filter_map(signed_format)
        .map(|cipher| cipher.signature)
        .collect();
    let solved_signatures =
        remote_decoder::decode(player, remote_decoder::Challenge::Signature, &signatures).await;
    let urls: Vec<Option<String>> = formats()
        .map(|format| match signed_format(format) {
            Some(cipher) => solved_signatures
                .get(&cipher.signature)
                .and_then(|signature| cipher.signed_url(signature)),
            None => format["url"].as_str().map(ToOwned::to_owned),
        })
        .collect();
    let challenges: Vec<String> = urls
        .iter()
        .flatten()
        .filter_map(|url| query_param(url, "n"))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let solved_n = remote_decoder::decode(player, remote_decoder::Challenge::N, &challenges).await;

    let mut urls = urls.into_iter();
    for key in ["formats", "adaptiveFormats"] {
        let Some(formats) = streaming[key].as_array_mut() else {
            continue;
        };
        for format in formats {
            let Some(url) = urls.next().flatten() else {
                continue;
            };
            let Some(url) = with_solved_n(&url, &solved_n) else {
                continue;
            };
            format["url"] = Value::String(url);
            if let Some(object) = format.as_object_mut() {
                object.remove("signatureCipher");
                object.remove("cipher");
            }
        }
    }
}

struct SignedFormat {
    base_url: String,
    signature: String,
    parameter: String,
}

impl SignedFormat {
    fn signed_url(&self, signature: &str) -> Option<String> {
        let mut url = reqwest::Url::parse(&self.base_url).ok()?;
        url.query_pairs_mut()
            .append_pair(&self.parameter, signature);
        Some(url.into())
    }
}

fn signed_format(format: &Value) -> Option<SignedFormat> {
    let cipher = format["signatureCipher"]
        .as_str()
        .or_else(|| format["cipher"].as_str())?;
    let parsed = reqwest::Url::parse(&format!("https://example.invalid/?{cipher}")).ok()?;
    let mut base_url = None;
    let mut signature = None;
    let mut parameter = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "url" => base_url = Some(value.into_owned()),
            "s" => signature = Some(value.into_owned()),
            "sp" => parameter = Some(value.into_owned()),
            _ => {}
        }
    }
    Some(SignedFormat {
        base_url: base_url?,
        signature: signature?,
        parameter: parameter.unwrap_or_else(|| "signature".to_string()),
    })
}

fn query_param(url: &str, key: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()?
        .query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

/// `url` with its `n` swapped for the solved one, and remembered as solved. A
/// URL without `n` is returned as is; None when its `n` was not solved, since
/// googlevideo throttles it.
fn with_solved_n(url: &str, solved_n: &HashMap<String, String>) -> Option<String> {
    let mut parsed = reqwest::Url::parse(url).ok()?;
    let pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if !pairs.iter().any(|(key, _)| key == "n") {
        return Some(url.to_string());
    }
    let mut query = parsed.query_pairs_mut();
    query.clear();
    for (key, value) in pairs {
        if key == "n" {
            query.append_pair("n", solved_n.get(&value)?);
        } else {
            query.append_pair(&key, &value);
        }
    }
    drop(query);
    remote_decoder::note_solved_url(parsed.as_str());
    Some(parsed.into())
}

/// Whether a response is a live or just-ended stream played from its manifest:
/// it says it is live or post-live DVR, carries live streamability, or offers a
/// manifest with no adaptive formats beside it. Clients such as `VISIONOS` also
/// send an HLS manifest for plain videos, which keep their adaptive formats.
fn has_live_manifest(response: &Value) -> bool {
    let streaming_data = &response["streamingData"];
    let has_manifest = streaming_data["hlsManifestUrl"].is_string()
        || streaming_data["dashManifestUrl"].is_string();
    let details = &response["videoDetails"];
    let says_live = details["isLive"].as_bool().unwrap_or(false)
        || details["isPostLiveDvr"].as_bool().unwrap_or(false)
        || response["playabilityStatus"]["liveStreamability"].is_object();
    let no_adaptive = streaming_data["adaptiveFormats"]
        .as_array()
        .is_none_or(Vec::is_empty);
    has_manifest && (says_live || no_adaptive)
}

/// A live broadcast or a just-ended one still served as live.
fn is_live_response(response: &Value) -> bool {
    let details = &response["videoDetails"];
    details["isLive"].as_bool().unwrap_or(false)
        || details["isPostLiveDvr"].as_bool().unwrap_or(false)
}

impl InnertubeClient {
    /// The playback ladder walk every caller for a given video shares.
    ///
    /// Playback and the metadata around it need the same `player` response, and
    /// they ask for it within moments of each other. Going through here means
    /// the second ask is answered from memory instead of paying a second walk
    /// that would compete with the first buffer for the same connection pool.
    async fn resolve_player_attempt(
        &self,
        video_id: &str,
        deferred_restriction: &mut Option<AppError>,
        refresh: bool,
    ) -> Option<PlayerAttempt> {
        static FLIGHTS: OnceLock<PlayerFlights<(Option<PlayerAttempt>, Option<LadderReport>)>> =
            OnceLock::new();
        // A refresh replaces URLs that already failed, so it must never be
        // answered by a normal walk that started before them.
        let flight_key = if refresh {
            format!("refresh:{video_id}")
        } else {
            video_id.to_string()
        };
        let flight = FLIGHTS
            .get_or_init(PlayerFlights::default)
            .for_video(&flight_key);
        let outcome = flight
            .get_or_init(|| async {
                if refresh {
                    invalidate_player_response(video_id);
                } else if let Some(cached) = cached_player_attempt(video_id) {
                    debug!(
                        video_id,
                        client = cached.client.name,
                        "Reusing cached player response"
                    );
                    return (Some(cached), None);
                }
                let visitor_data = self.fetch_visitor_data().await;
                let mut restriction = None;
                let attempt = self
                    .try_player_ladder(
                        video_id,
                        PLAYER_CLIENT_LADDER,
                        visitor_data,
                        &mut restriction,
                    )
                    .await;
                let attempt = match attempt {
                    Some(direct) => Some(self.upgrade_to_sabr(video_id, direct).await),
                    None => None,
                };
                if let Some(attempt) = attempt.as_ref() {
                    store_player_attempt(video_id, attempt);
                }
                (attempt, restriction)
            })
            .await;
        if let Some(report) = outcome.1.as_ref() {
            *deferred_restriction = Some(report.to_error());
        }
        outcome.0.clone()
    }

    /// `direct`, or a web SABR answer for the same video when `direct` tops out
    /// below [`SABR_UPGRADE_FLOOR`] and the SABR answer is taller. The web
    /// clients are asked within [`SABR_UPGRADE_BUDGET`] and under the same
    /// visitor, never a fresh one: a video that already plays is not worth a new
    /// identity.
    async fn upgrade_to_sabr(&self, video_id: &str, direct: PlayerAttempt) -> PlayerAttempt {
        if direct.client.is_web_sabr() || is_live_response(&direct.response) {
            return direct;
        }
        let direct_height = max_video_height(&direct.response["streamingData"]);
        if direct_height >= SABR_UPGRADE_FLOOR {
            return direct;
        }
        let visitor_data = direct.visitor_data.clone();
        let upgrade = tokio::time::timeout(SABR_UPGRADE_BUDGET, async {
            for client in gated_last(SABR_UPGRADE_CLIENTS.iter().copied(), |client| client.name) {
                if let ClientOutcome::Won(attempt) = self
                    .attempt_client(video_id, client, visitor_data.as_deref())
                    .await
                {
                    return Some(attempt);
                }
            }
            None
        })
        .await
        .ok()
        .flatten();
        match upgrade {
            Some(sabr) if max_video_height(&sabr.response["streamingData"]) > direct_height => {
                info!(video_id = %video_id, direct = direct.client.name, sabr = sabr.client.name, direct_height, "Direct ladder capped; using SABR");
                sabr
            }
            _ => direct,
        }
    }

    /// Walk `ladder` in order, returning the first client that answers with
    /// streams Flow can fetch.
    ///
    /// The first bot wall gets one retry of that client under a freshly issued
    /// visitor identity, which every later client then inherits: a stale or
    /// flagged visitorData walls every client alike, so walking on with it only
    /// spends the ladder. A content-level refusal (region, privacy, membership,
    /// age, removal) ends the walk at once and is recorded in
    /// `deferred_restriction`, so the caller surfaces that specific reason
    /// instead of a generic failure.
    async fn try_player_ladder(
        &self,
        video_id: &str,
        ladder: &[&'static clients::YouTubeClient],
        visitor_data: Option<String>,
        deferred_restriction: &mut Option<LadderReport>,
    ) -> Option<PlayerAttempt> {
        let mut visitor_data = visitor_data;
        let mut identity_refreshed = false;
        let mut fresh_identity_walled = false;
        for client in gated_last(ladder.iter().copied(), |client| client.name) {
            let mut outcome = self
                .attempt_client(video_id, client, visitor_data.as_deref())
                .await;
            if !identity_refreshed
                && matches!(&outcome, ClientOutcome::Refused(refusal) if is_bot_wall(&refusal.playability))
            {
                identity_refreshed = true;
                if let Some(fresh) = self.refresh_visitor_data(visitor_data.as_deref()).await {
                    info!(video_id = %video_id, client = client.name, "Bot wall; retrying under a fresh visitor identity");
                    visitor_data = Some(fresh);
                    outcome = self
                        .attempt_client(video_id, client, visitor_data.as_deref())
                        .await;
                    fresh_identity_walled = matches!(
                        &outcome,
                        ClientOutcome::Refused(refusal) if is_bot_wall(&refusal.playability)
                    );
                }
            }

            match outcome {
                ClientOutcome::Won(attempt) => {
                    info!(video_id = %video_id, client = client.name, version = client.version, "Player ladder resolved");
                    return Some(attempt);
                }
                ClientOutcome::Refused(refusal) => {
                    warn!(
                        video_id = %video_id,
                        client = client.name,
                        version = client.version,
                        reason = %map_playability_error(&refusal.playability),
                        "Player client refused, trying the next one"
                    );
                    let ends = ends_the_ladder(&refusal);
                    if is_better_report(
                        deferred_restriction.as_ref().map(|report| &report.refusal),
                        &refusal,
                    ) {
                        *deferred_restriction = Some(LadderReport {
                            refusal,
                            fresh_identity_walled,
                        });
                    }
                    if ends {
                        return None;
                    }
                }
                ClientOutcome::Unusable => {}
            }
        }
        None
    }

    /// One client's turn on the ladder: request, then judge the answer by what
    /// Flow can actually play rather than by its status alone.
    async fn attempt_client(
        &self,
        video_id: &str,
        client: &'static clients::YouTubeClient,
        visitor_data: Option<&str>,
    ) -> ClientOutcome {
        let web_client = client.is_web_sabr();
        // Web clients are only served with a BotGuard token on the request, bound
        // to the video id as Flow for Android binds it. Every other family is
        // attested by a runtime Flow cannot run, and a BotGuard token on those is
        // a claim googlevideo validates and refuses.
        let po_token = if web_client {
            let Some(token) = generate_po_token(video_id).await else {
                warn!(video_id = %video_id, client = client.name, "No PO token; skipping web client");
                return ClientOutcome::Unusable;
            };
            Some(token)
        } else {
            None
        };

        let decoder_player = if client.remote_signed {
            let Some(player) = remote_decoder::latest_player().await else {
                debug!(video_id = %video_id, client = client.name, "Remote decoder off or unreachable; skipping");
                return ClientOutcome::Unusable;
            };
            Some(player)
        } else {
            None
        };
        let cpn = web_client.then(new_cpn);
        let mut response = match self
            .request_player(
                video_id,
                client,
                visitor_data,
                po_token.as_deref(),
                None,
                cpn.as_deref(),
            )
            .await
        {
            Some(value) => value,
            // The lead client gets one more try: a cold DNS/TLS handshake can eat
            // the whole first budget.
            None if std::ptr::eq(client, PLAYER_CLIENT_LADDER[0]) => {
                match self
                    .request_player(
                        video_id,
                        client,
                        visitor_data,
                        po_token.as_deref(),
                        None,
                        cpn.as_deref(),
                    )
                    .await
                {
                    Some(value) => value,
                    None => return ClientOutcome::Unusable,
                }
            }
            None => return ClientOutcome::Unusable,
        };

        // A `needs reload` response clears if the request looks like it came
        // from the short link rather than the watch page.
        if check_needs_reload(&response) {
            let referer = format!("https://youtu.be/{video_id}");
            match self
                .request_player(
                    video_id,
                    client,
                    visitor_data,
                    po_token.as_deref(),
                    Some(&referer),
                    cpn.as_deref(),
                )
                .await
            {
                Some(retry) => response = retry,
                None => return ClientOutcome::Unusable,
            }
        }

        let status = response["playabilityStatus"]["status"]
            .as_str()
            .unwrap_or_default();
        if !status.eq_ignore_ascii_case("OK") {
            return ClientOutcome::Refused(Refusal::of(&response));
        }

        if let Some(player) = decoder_player.as_ref() {
            solve_formats(&mut response, player).await;
        }

        let playable = if has_live_manifest(&response) {
            true
        } else if web_client {
            self.prepare_sabr_endpoint(video_id, client, &mut response, cpn.as_deref())
                .await
        } else {
            has_playable_direct_streams(&response["streamingData"], video_id)
        };
        if !playable {
            warn!(video_id = %video_id, client = client.name, "Player client answered OK with nothing Flow can fetch");
            return ClientOutcome::Unusable;
        }
        let preroll = preroll_wait(&response["adPlacements"]);
        if !preroll.is_zero() {
            debug!(video_id = %video_id, client = client.name, ?preroll, "Waiting out the pre-roll before the streams are served");
            tokio::time::sleep(preroll).await;
        }

        ClientOutcome::Won(PlayerAttempt {
            response,
            client,
            po_token,
            visitor_data: visitor_data.map(ToOwned::to_owned),
        })
    }

    /// A web client's response is SABR-only: playable once its SABR endpoint
    /// carries a solved `n`, which googlevideo otherwise refuses outright. The
    /// solved URL is written back so every later reader of the response uses it.
    async fn prepare_sabr_endpoint(
        &self,
        video_id: &str,
        client: &clients::YouTubeClient,
        response: &mut Value,
        cpn: Option<&str>,
    ) -> bool {
        let streaming_data = &response["streamingData"];
        let Some(server_url) = extract_server_abr_url(streaming_data) else {
            return false;
        };
        if extract_ustreamer_config(response).is_empty()
            || select_formats(
                &parse_sabr_formats(streaming_data),
                None,
                CodecSupport::default(),
            )
            .is_none()
        {
            return false;
        }
        let Some(solved) = player_js::solve_n_in_url(&server_url).await else {
            warn!(video_id = %video_id, client = client.name, "Could not solve n for the SABR endpoint");
            return false;
        };
        let solved = cpn.map_or_else(|| solved.clone(), |cpn| with_session_params(&solved, cpn));
        response["streamingData"]["serverAbrStreamingUrl"] = Value::String(solved);
        true
    }

    /// One `player` request as `client`, carrying whatever that client's profile
    /// asks for: signature timestamp, embed URL, PO token.
    async fn request_player(
        &self,
        video_id: &str,
        client: &clients::YouTubeClient,
        visitor_data: Option<&str>,
        po_token: Option<&str>,
        referer: Option<&str>,
        cpn: Option<&str>,
    ) -> Option<Value> {
        let mut payload = client.player_body(video_id, visitor_data, po_token);
        if client.use_signature_timestamp {
            // A remote-signed client's signatures are solved against the
            // decoder's player, so the request must name that player's timestamp.
            let remote_timestamp = if client.remote_signed {
                remote_decoder::latest_player()
                    .await
                    .and_then(|player| player.signature_timestamp)
            } else {
                None
            };
            let timestamp = match remote_timestamp {
                Some(timestamp) => timestamp,
                None => player_js::signature_timestamp()
                    .await
                    .unwrap_or(clients::DEFAULT_SIGNATURE_TIMESTAMP),
            };
            let watch_url = format!("https://www.youtube.com/watch?v={video_id}");
            let mut content = serde_json::json!({
                "referer": referer.unwrap_or(if client.is_web_sabr() {
                    &watch_url
                } else {
                    "https://www.youtube.com"
                }),
                "signatureTimestamp": timestamp,
                "html5Preference": "HTML5_PREF_WANTS"
            });
            // The web player's own context, which a SABR session is checked against.
            if client.is_web_sabr() {
                content["vis"] = serde_json::json!(0);
                content["splay"] = serde_json::json!(false);
                content["lactMilliseconds"] = serde_json::json!("-1");
            }
            payload["playbackContext"] = serde_json::json!({ "contentPlaybackContext": content });
            if client.is_web_sabr()
                && let Some(token) = take_reload_token(video_id)
            {
                payload["playbackContext"]["reloadPlaybackContext"] =
                    serde_json::json!({ "reloadPlaybackParams": { "token": token } });
            }
        }
        if let Some(cpn) = cpn {
            payload["cpn"] = serde_json::json!(cpn);
        }

        let budget = if client.is_web_sabr() || client.remote_signed {
            WEB_PLAYER_TIMEOUT
        } else {
            PER_CLIENT_TIMEOUT
        };
        match tokio::time::timeout(budget, self.post_player(client, &mut payload, referer)).await {
            Ok(Ok(value)) => Some(value),
            Ok(Err(error)) => {
                warn!(video_id = %video_id, client = client.name, %error, "Player request failed");
                None
            }
            Err(_) => {
                warn!(video_id = %video_id, client = client.name, "Player request timed out");
                None
            }
        }
    }
}

impl InnertubeClient {
    /// Channel and duration for a listed video, from one VISIONOS `player`
    /// request on the shared connection.
    ///
    /// Feeds fill these in for dozens of videos at a time. Doing it with the
    /// full details lookup cost a ladder walk plus a `next` request each, on the
    /// connection reserved for playback, and on a slow link that bulk traffic
    /// delayed whatever the user was trying to play. This waits while a stream
    /// is resolving and gives up quickly instead of walking the ladder.
    pub async fn get_video_basics(&self, video_id: &str) -> AppResult<VideoBasics> {
        let video_id = video_id.trim();
        if video_id.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        let _priority = playback_priority().start_metadata().await;
        let visitor_data = self.fetch_visitor_data().await;
        let mut payload = serde_json::json!({
            "context": clients::VISIONOS.context(visitor_data.as_deref(), None),
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
        });
        let response = tokio::time::timeout(
            PER_CLIENT_TIMEOUT,
            self.post_innertube("player", &clients::VISIONOS, &mut payload),
        )
        .await
        .map_err(|_| AppError::Extractor(format!("Basics lookup timed out for {video_id}")))??;

        check_playability_status(&response["playabilityStatus"])?;
        let details = &response["videoDetails"];
        Ok(VideoBasics {
            channel_id: details["channelId"].as_str().map(ToOwned::to_owned),
            duration_seconds: details["lengthSeconds"]
                .as_str()
                .and_then(|seconds| seconds.parse().ok()),
        })
    }

    pub async fn get_video_details(&self, video_id: &str) -> AppResult<VideoDetails> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        let _priority = playback_priority().start_metadata().await;

        let mut deferred_restriction: Option<AppError> = None;
        let attempt = self
            .resolve_player_attempt(video_id_trimmed, &mut deferred_restriction, false)
            .await;

        let res = match attempt {
            Some(attempt) => attempt.response,
            None => {
                return Err(deferred_restriction.unwrap_or_else(|| {
                    AppError::Extractor(format!(
                        "No client could load details for video {video_id_trimmed}"
                    ))
                }));
            }
        };

        check_playability_status(&res["playabilityStatus"])?;

        let details = &res["videoDetails"];
        if details.is_null() {
            return Err(AppError::Extractor(
                "Failed to fetch video details from Innertube".into(),
            ));
        }

        let id = details["videoId"]
            .as_str()
            .unwrap_or(video_id_trimmed)
            .to_string();
        let duration_seconds = extract_duration_seconds_from_player_response(&res);
        // Views, likes, dates and the owner block are optional: a deep link waits
        // on this call before it starts playback, so a slow or failed watch answer
        // leaves them out instead of failing the details.
        let next = self.watch_next(&id).await.ok();
        let next = next.as_deref().unwrap_or(&Value::Null);
        let primary = watch_next::primary(next);
        let owner = watch_next::owner(next);

        // The TV client's details carry neither title, author nor description;
        // the watch answer fills them in.
        let description = details["shortDescription"]
            .as_str()
            .map(ToString::to_string)
            .or_else(|| watch_next::description(next));
        let (mut chapters, auto_chapters) =
            watch_next::chapters(next, duration_seconds.unwrap_or(0));
        if chapters.is_empty()
            && let Some(description) = description.as_deref()
        {
            chapters = watch_next::description_chapters(description, duration_seconds.unwrap_or(0));
        }

        let description_rich = watch_next::description_rich(next, description.as_deref(), &id);
        Ok(VideoDetails {
            title: details["title"]
                .as_str()
                .filter(|title| !title.is_empty())
                .map(ToOwned::to_owned)
                .or(primary.title)
                .unwrap_or_default(),
            channel_name: details["author"]
                .as_str()
                .filter(|author| !author.is_empty())
                .map(ToOwned::to_owned)
                .or(owner.name)
                .unwrap_or_default(),
            channel_id: details["channelId"]
                .as_str()
                .map(ToOwned::to_owned)
                .or(owner.channel_id),
            description,
            thumbnail_url: thumbnail_url_from_array(&details["thumbnail"]["thumbnails"]),
            duration_seconds,
            like_count_text: primary.like_count_text,
            view_count_text: primary.view_count_text,
            published_text: primary
                .published_text
                .or_else(|| primary.relative_published_text.clone()),
            relative_published_text: primary.relative_published_text,
            chapters,
            auto_chapters,
            heatmap: watch_next::heatmap(next),
            is_live: details["isLive"].as_bool().unwrap_or(false),
            category: res["microformat"]["playerMicroformatRenderer"]["category"]
                .as_str()
                .map(str::to_string),
            channel_avatar_url: owner.avatar_url,
            subscriber_count_text: owner.subscriber_count_text,
            channel_badge: owner.badge.map(ToOwned::to_owned),
            collaborators: owner.collaborators,
            hashtags: primary.hashtags,
            badges: primary.badges,
            autoplay_video_id: watch_next::autoplay_video_id(next),
            has_chat_replay: watch_next::chat_seed(next).is_some_and(|(_, replay)| replay),
            description_rich,
            description_extras: watch_next::description_extras(next),
            id,
        })
    }

    pub async fn get_related_videos(&self, video_id: &str) -> AppResult<RelatedPage> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }
        let next = self.watch_next(video_id_trimmed).await?;
        Ok(watch_next::related_page(&next))
    }

    /// The related lane of a video that is not being watched, for the home
    /// feed. A cached watch answer is used when there is one, but this never
    /// fills the cache or takes a playback connection: feeds ask for many
    /// videos, and would push out the one on screen.
    pub async fn get_feed_related_videos(&self, video_id: &str) -> AppResult<RelatedPage> {
        if let Some(next) = watch_next::cached(video_id) {
            return Ok(watch_next::related_page(&next));
        }
        let mut payload = watch_next_body(video_id);
        let next = self
            .post_innertube("next", &clients::WEB, &mut payload)
            .await?;
        Ok(watch_next::related_page(&next))
    }

    /// The related lane's next page.
    pub async fn get_more_related_videos(&self, continuation: &str) -> AppResult<RelatedPage> {
        let mut payload = serde_json::json!({ "continuation": continuation });
        let next = self
            .post_innertube("next", &clients::WEB, &mut payload)
            .await?;
        Ok(watch_next::related_page(&next))
    }

    pub async fn get_stream_info(&self, video_id: &str, refresh: bool) -> AppResult<StreamInfo> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        let _priority = playback_priority().start_stream();

        // Walk the client ladder; the first playable response wins.
        let mut deferred_restriction: Option<AppError> = None;
        let attempt = self
            .resolve_player_attempt(video_id_trimmed, &mut deferred_restriction, refresh)
            .await;
        let visitor_data_for_sabr = attempt
            .as_ref()
            .and_then(|attempt| attempt.visitor_data.clone());

        let winning_client = attempt
            .as_ref()
            .map_or(&clients::VISIONOS, |attempt| attempt.client);
        let po_token_used = attempt
            .as_ref()
            .and_then(|attempt| attempt.po_token.clone());
        let res = match attempt {
            Some(attempt) => Ok(attempt.response),
            None => Err(deferred_restriction.take().unwrap_or_else(|| {
                AppError::Extractor(format!(
                    "No client could resolve a stream for video {video_id_trimmed}"
                ))
            })),
        };

        let res = res?;
        let playability = &res["playabilityStatus"];
        check_playability_status(playability)?;
        debug!(video_id = %video_id_trimmed, ?playability, "Resolved playback playability status");

        let streaming_data = &res["streamingData"];
        if streaming_data.is_null() {
            if let Some(restriction) = deferred_restriction.take() {
                return Err(restriction);
            }
            return Err(AppError::Extractor(format!(
                "No streaming data found. Playability: {} (Status: {})",
                playability["reason"]
                    .as_str()
                    .unwrap_or("Unknown playability reason"),
                playability["status"].as_str().unwrap_or("UNKNOWN")
            )));
        }

        let is_live = is_live_response(&res);
        let mut hls_manifest_url = streaming_data["hlsManifestUrl"]
            .as_str()
            .map(ToOwned::to_owned);
        let mut dash_manifest_url = streaming_data["dashManifestUrl"]
            .as_str()
            .map(ToOwned::to_owned);

        // Live broadcasts play from the HLS/DASH manifest, not a progressive variant.
        // When the winning client exposed none, ask the clients that reliably do.
        // A restriction seen here is discarded: the video already resolved, so a
        // missing manifest is not the reason to fail it.
        if is_live && hls_manifest_url.is_none() {
            let mut discarded: Option<LadderReport> = None;
            if let Some(live) = self
                .try_player_ladder(
                    video_id_trimmed,
                    LIVE_MANIFEST_CLIENTS,
                    visitor_data_for_sabr.clone(),
                    &mut discarded,
                )
                .await
            {
                if let Some(hls) = live.response["streamingData"]["hlsManifestUrl"].as_str() {
                    hls_manifest_url = Some(hls.to_string());
                }
                if dash_manifest_url.is_none() {
                    if let Some(dash) = live.response["streamingData"]["dashManifestUrl"].as_str() {
                        dash_manifest_url = Some(dash.to_string());
                    }
                }
            }
        }

        let (variants, mut last_stream_error) =
            collect_stream_variants(streaming_data, video_id_trimmed);
        let mut stream_url = variants
            .iter()
            .find(|variant| variant.is_playable)
            .map(|variant| variant.local_url.clone());

        // Fallback: search adaptive formats (video only or audio only)
        if stream_url.is_none() {
            if let Some(adaptive_formats) = streaming_data["adaptiveFormats"].as_array() {
                for format in adaptive_formats {
                    match extract_stream_url_from_format(format, video_id_trimmed) {
                        Ok(Some(url)) => {
                            stream_url = Some(url);
                            break;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            last_stream_error = Some(error);
                        }
                    }
                }
            }
        }

        let has_sabr_url = !streaming_data["serverAbrStreamingUrl"]
            .as_str()
            .unwrap_or_default()
            .is_empty();
        let local_url = match stream_url {
            Some(url) => url,
            None => {
                // A live broadcast plays from its manifest, and a SABR-only response
                // (e.g. the in-page WEB recovery) plays from the SABR engine — so a
                // missing progressive URL is fine in both cases.
                if (is_live && (hls_manifest_url.is_some() || dash_manifest_url.is_some()))
                    || has_sabr_url
                {
                    String::new()
                } else if let Some(restriction) = deferred_restriction.take() {
                    return Err(restriction);
                } else {
                    return Err(last_stream_error.unwrap_or_else(|| {
                        AppError::Extractor("No playable stream URLs found for this video".into())
                    }));
                }
            }
        };

        let expires_in_seconds = streaming_data["expiresInSeconds"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(21600); // Default 6 hours

        // Return expiration time and user-agent string joined by | delimiter
        let composite_expires_at = format!("{}|{}", expires_in_seconds, winning_client.user_agent);

        // Offer every dubbed language alongside the original. VISIONOS serves these
        // as direct URLs googlevideo streams in full — the earlier iPadOS-sourced
        // dubs were the ones it refused, and those are no longer how they are
        // fetched.
        let download_audio_tracks = collect_audio_tracks(streaming_data, winning_client.user_agent);
        let audio_tracks = select_playable_audio_tracks(&download_audio_tracks);
        debug!(
            video_id = %video_id_trimmed,
            languages = audio_tracks.len(),
            "Resolved selectable audio tracks"
        );

        // Extract SABR metadata (safe: never fails the request, only annotates).
        // SABR is retained only as the original-audio bot-wall fallback.
        let duration_seconds = extract_duration_seconds_from_player_response(&res);
        let (sabr, sabr_descriptor) = build_sabr_metadata(
            &res,
            streaming_data,
            video_id_trimmed,
            visitor_data_for_sabr,
            po_token_used,
            winning_client,
            duration_seconds,
        );

        Ok(StreamInfo {
            stream_id: video_id_trimmed.to_string(),
            local_url,
            expires_at: composite_expires_at,
            variants,
            captions: collect_caption_tracks(&res),
            audio_tracks,
            download_audio_tracks,
            hls_manifest_url,
            dash_manifest_url,
            is_live,
            sabr,
            sabr_descriptor,
        })
    }
}

// Live network smoke test for the SABR stack. Ignored by default; run with:
//   FLOW_SABR_VIDEO=3RmOvxilbPM cargo test -p flow sabr_live_smoke -- --ignored --nocapture
#[cfg(test)]
mod sabr_live_smoke {
    use super::*;
    use crate::streaming::sabr::engine::{SabrEngine, SabrEngineConfig};
    use crate::streaming::sabr::selector::{CodecSupport, select_formats};
    use crate::streaming::sabr::session::RequestMode;
    use crate::streaming::sabr::{ClientProfile, SabrSessionDescriptor, SabrTrack};
    use std::sync::Arc;

    fn ipados_profile() -> ClientProfile {
        ClientProfile::from_client(&clients::IPADOS)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "hits the network + botguard sidecar"]
    async fn sabr_live_smoke() {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_test_writer()
            .try_init();
        let video_id =
            std::env::var("FLOW_SABR_VIDEO").unwrap_or_else(|_| "3RmOvxilbPM".to_string());
        let client = InnertubeClient::new();

        let visitor_data = client.fetch_visitor_data().await;
        let po_token = match visitor_data.as_deref() {
            Some(vd) if !vd.is_empty() => {
                crate::api::innertube::core::botguard::generate_po_token(vd).await
            }
            _ => None,
        };
        println!(
            "visitor_data present={} po_token present={}",
            visitor_data.is_some(),
            po_token.is_some()
        );

        let mut payload =
            clients::IPADOS.player_body(&video_id, visitor_data.as_deref(), po_token.as_deref());
        payload["playbackContext"] =
            serde_json::json!({ "contentPlaybackContext": { "signatureTimestamp": 19550 } });
        let res = client
            .post_innertube("player", &clients::IPADOS, &mut payload)
            .await
            .expect("ipados player request");
        let streaming_data = &res["streamingData"];

        let server_url = extract_server_abr_url(streaming_data).expect("serverAbrStreamingUrl");
        let ustreamer_config = extract_ustreamer_config(&res);
        let formats = parse_sabr_formats(streaming_data);
        let dubbed = formats
            .iter()
            .filter(|f| f.is_audio && f.xtags.as_deref().is_some_and(|x| x.contains("dubbed")))
            .count();
        println!(
            "formats={} (dubbed audio={}) ustreamer_cfg={}B",
            formats.len(),
            dubbed,
            ustreamer_config.len()
        );
        let selected = select_formats(&formats, None, CodecSupport::default()).expect("selectable");
        println!(
            "selected audio itag={} video itag={} ({}x{})",
            selected.audio.itag, selected.video.itag, selected.video.width, selected.video.height
        );

        let duration_ms = extract_duration_seconds_from_player_response(&res)
            .map(|s| s * 1000)
            .unwrap_or(0);
        let descriptor = SabrSessionDescriptor {
            video_id: video_id.clone(),
            server_abr_streaming_url: server_url,
            visitor_data: visitor_data.clone(),
            po_token,
            ustreamer_config,
            client_profile: ipados_profile(),
            duration_ms,
            formats,
        };

        // Audio-only: video keeps using the range-friendly ANDROID_VR DASH path;
        // SABR carries only the (dubbed-capable) audio. Small segments, no 3MB
        // video blocking the stream.
        let config = SabrEngineConfig {
            mode: RequestMode::AudioOnly,
            segment_wait: std::time::Duration::from_secs(30),
            ..Default::default()
        };
        let engine = Arc::new(SabrEngine::new(
            video_id.clone(),
            descriptor,
            selected,
            config,
        ));
        engine.clone().spawn();

        let timing = match engine.wait_timing(std::time::Duration::from_secs(15)).await {
            Ok(t) => t,
            Err(e) => {
                let st = engine.debug_state().await;
                panic!(
                    "wait_timing failed: {e}; debug_state: req_count={} redirects={} bytes={} \
                     last_error={:?} protection={} a_init={} v_init={} effective_url={}",
                    st.request_count,
                    st.redirect_count,
                    st.bytes_used,
                    st.last_error,
                    st.last_protection_status,
                    st.audio_initialized,
                    st.video_initialized,
                    st.effective_url
                );
            }
        };
        println!(
            "timing: duration_ms={} audio_segs={} video_segs={}",
            timing.duration_ms, timing.audio_segment_count, timing.video_segment_count
        );

        let a_init = engine.get_init(SabrTrack::Audio).await.expect("audio init");
        // Media segments start at sequence 1 (sequence 0 is the init segment).
        let a_seg1 = engine.get_segment(SabrTrack::Audio, 1).await;
        let a_seg2 = engine.get_segment(SabrTrack::Audio, 2).await;
        let a_seg3 = engine.get_segment(SabrTrack::Audio, 3).await;
        let st = engine.debug_state().await;
        println!(
            "FETCHED audio_init={}B audio_seg1={:?} audio_seg2={:?} audio_seg3={:?}",
            a_init.len(),
            a_seg1.as_ref().map(|b| b.len()),
            a_seg2.as_ref().map(|b| b.len()),
            a_seg3.as_ref().map(|b| b.len()),
        );
        println!(
            "debug_state: reqs={} bytes={} a_segs={} a_max={} err={:?}",
            st.request_count, st.bytes_used, st.audio_segments, st.audio_max_seq, st.last_error
        );
        assert!(!a_init.is_empty(), "audio init segment");
        assert!(
            a_seg1.is_ok() && a_seg2.is_ok(),
            "audio media segments must finalize"
        );
        println!("SABR SMOKE OK (audio-only media flowing)");

        // Multi-audio: switch to a dubbed language and verify its audio flows,
        // including a mid-stream segment (exercises the audio-seek path).
        let tracks: Vec<_> = engine.audio_tracks().to_vec();
        println!(
            "audio tracks ({}): {:?}",
            tracks.len(),
            tracks
                .iter()
                .map(|t| format!("{}={}", t.key, t.label))
                .collect::<Vec<_>>()
        );
        if let Some(dubbed) = tracks.iter().find(|t| !t.is_default) {
            println!(
                "switching to dubbed: key={} lang={} label={}",
                dubbed.key, dubbed.lang, dubbed.label
            );
            assert!(engine.set_active_audio(&dubbed.key).await, "known track");
            let d_init = engine.get_init(SabrTrack::Audio).await;
            let d_seg1 = engine.get_segment(SabrTrack::Audio, 1).await;
            engine.ensure_audio_segment(20).await;
            let d_seg20 = engine.get_segment(SabrTrack::Audio, 20).await;
            println!(
                "dubbed[{}] init={:?} seg1={:?} seg20(seek)={:?}",
                dubbed.key,
                d_init.as_ref().map(|b| b.len()),
                d_seg1.as_ref().map(|b| b.len()),
                d_seg20.as_ref().map(|b| b.len()),
            );
            assert!(
                d_init.is_ok() && d_seg1.is_ok(),
                "dubbed audio must flow after switch"
            );
            println!("MULTI-AUDIO SWITCH OK");
        } else {
            println!("NOTE: no dubbed track found on this video");
        }
    }
}

// Sustained multi-client SABR probe.
// This probe streams the WHOLE audio track under each candidate client and reports
// which ones sustain vs. escalate to ATTESTATION_REQUIRED, so we can pick a
// client whose attestation our (web BotGuard) PO token actually satisfies.
//   cargo test -p flow sabr_client_probe -- --ignored --nocapture
#[cfg(test)]
mod sabr_client_probe {
    use super::*;
    use crate::streaming::sabr::engine::{SabrEngine, SabrEngineConfig};
    use crate::streaming::sabr::selector::{CodecSupport, derive_audio_tracks, select_formats};
    use crate::streaming::sabr::session::RequestMode;
    use crate::streaming::sabr::{ClientProfile, SabrSessionDescriptor, SabrTrack};
    use std::collections::BTreeSet;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    /// Builds the body straight from the registry, so the probe measures the
    /// same identity the app actually sends rather than a copy of it.
    ///
    /// `pot` is passed through `player_body`, which drops it for any client
    /// whose attestation platform a web PO token is not valid for, so a run
    /// with `send_pot = true` on an iOS/Android client is the control case
    /// showing that omitting the token changes nothing for them.
    fn body_for(
        video_id: &str,
        client: &clients::YouTubeClient,
        visitor: Option<String>,
        pot: Option<String>,
    ) -> Value {
        let mut body = client.player_body(video_id, visitor.as_deref(), pot.as_deref());
        if let Some(timestamp) = client.signature_timestamp() {
            body["playbackContext"] = serde_json::json!({
                "contentPlaybackContext": { "signatureTimestamp": timestamp }
            });
        }
        body
    }

    async fn raw_player(c: &clients::YouTubeClient, payload: Value) -> Option<Value> {
        let r = reqwest::Client::new()
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header(reqwest::header::USER_AGENT, c.user_agent)
            .header("X-YouTube-Client-Name", c.client_id)
            .header("X-YouTube-Client-Version", c.version)
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com")
            .header("Cookie", "SOCS=CAE=")
            .json(&payload)
            .send()
            .await
            .ok()?;
        r.json::<Value>().await.ok()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "hits the network + botguard sidecar"]
    async fn sabr_client_probe() {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .with_test_writer()
            .try_init();
        let video_id =
            std::env::var("FLOW_SABR_VIDEO").unwrap_or_else(|_| "3RmOvxilbPM".to_string());
        let client = InnertubeClient::new();
        // Allow injecting an externally-minted pot+visitor (e.g. from bgutils-js)
        // to test whether a *fresh, valid* pot sustains where the stale sidecar's
        // does not: FLOW_VISITOR=… FLOW_POT=… cargo test … sabr_client_probe …
        let (visitor_data, pot) = match (std::env::var("FLOW_VISITOR"), std::env::var("FLOW_POT")) {
            (Ok(v), Ok(p)) if !v.is_empty() && !p.is_empty() => {
                println!("USING injected visitor+pot (bgutils-js)");
                (Some(v), Some(p))
            }
            _ => {
                let vd = client.fetch_visitor_data().await;
                let p = match vd.as_deref() {
                    Some(vd) if !vd.is_empty() => {
                        crate::api::innertube::core::botguard::generate_po_token(vd).await
                    }
                    _ => None,
                };
                (vd, p)
            }
        };
        println!(
            "video={video_id} visitor={} pot={}\n",
            visitor_data.is_some(),
            pot.is_some()
        );

        // (candidate, send_pot) — the GVS/SABR endpoint validates the web pot
        // regardless of client, so the question is which client+pot combination
        // sustains a SABR stream past the attestation grace window.
        // VISIONOS leads the real ladder, so it is the one whose sustain behaviour
        // matters most here; the other two are the unattested clients it replaced.
        let candidates: [(&clients::YouTubeClient, bool); 6] = [
            (&clients::VISIONOS, false),
            (&clients::VISIONOS, true),
            (&clients::ANDROID, true),
            (&clients::ANDROID, false),
            (&clients::IPADOS, true),
            (&clients::IPADOS, false),
        ];

        for (c, send_pot) in candidates {
            let use_pot = if send_pot { pot.clone() } else { None };
            println!(
                "==== {} v{} pot_offered={} pot_sent={} ====",
                c.name,
                c.version,
                send_pot,
                send_pot && c.accepts_web_po_token()
            );
            let body = body_for(&video_id, c, visitor_data.clone(), use_pot.clone());
            let Some(res) = raw_player(c, body).await else {
                println!("  player request FAILED\n");
                continue;
            };
            let status = res["playabilityStatus"]["status"].as_str().unwrap_or("?");
            if !status.eq_ignore_ascii_case("OK") {
                println!(
                    "  playability={status} reason={:?}\n",
                    res["playabilityStatus"]["reason"].as_str()
                );
                continue;
            }
            let streaming_data = &res["streamingData"];
            let server_url = match extract_server_abr_url(streaming_data) {
                Some(u) => u,
                None => {
                    println!("  NO serverAbrStreamingUrl (cannot SABR)\n");
                    continue;
                }
            };
            let has_n = server_url.contains("&n=") || server_url.contains("?n=");
            let ustreamer_config = extract_ustreamer_config(&res);
            let formats = parse_sabr_formats(streaming_data);
            let langs: BTreeSet<String> = formats
                .iter()
                .filter(|f| f.is_audio)
                .filter_map(|f| {
                    f.audio_track_id
                        .as_deref()
                        .map(|id| id.split('.').next().unwrap_or(id).to_string())
                })
                .collect();
            let tracks = derive_audio_tracks(&formats);
            println!(
                "  OK formats={} audio_langs={} derived_tracks={} ustreamer={}B sabr_url_has_n={}",
                formats.len(),
                langs.len(),
                tracks.len(),
                ustreamer_config.len(),
                has_n
            );

            let selected = match select_formats(&formats, None, CodecSupport::default()) {
                Some(s) => s,
                None => {
                    println!("  no selectable formats\n");
                    continue;
                }
            };
            let duration_ms = extract_duration_seconds_from_player_response(&res)
                .map(|s| s * 1000)
                .unwrap_or(0);
            let descriptor = SabrSessionDescriptor {
                video_id: video_id.clone(),
                server_abr_streaming_url: server_url,
                visitor_data: visitor_data.clone(),
                po_token: use_pot.clone(),
                ustreamer_config,
                client_profile: ClientProfile::from_client(c),
                duration_ms,
                formats,
            };
            let config = SabrEngineConfig {
                mode: RequestMode::AudioOnly,
                segment_wait: Duration::from_secs(10),
                ..Default::default()
            };
            let engine = Arc::new(SabrEngine::new(
                video_id.clone(),
                descriptor,
                selected,
                config,
            ));
            engine.clone().spawn();

            // Drive continuous consumption: walk segments forward, ~realtime-ish,
            // for up to ~25s of wall time — long enough to blow past the grace
            // window. Stop on completion or a fatal (attestation) error.
            let start = Instant::now();
            let _ = engine.wait_timing(Duration::from_secs(12)).await;
            let mut next_seq = 1;
            let mut last_seq_ok = 0;
            loop {
                if start.elapsed() > Duration::from_secs(25) {
                    break;
                }
                let st = engine.debug_state().await;
                if st.done {
                    break;
                }
                if let Some(err) = &st.last_error {
                    if err.contains("Attestation") || st.last_protection_status == 3 {
                        break;
                    }
                }
                match engine.get_segment(SabrTrack::Audio, next_seq).await {
                    Ok(_) => {
                        last_seq_ok = next_seq;
                        next_seq += 1;
                    }
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                    }
                }
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
            let st = engine.debug_state().await;
            let err = st.last_error.clone().unwrap_or_default();
            let verdict = if st.last_protection_status == 3 || err.contains("Attestation") {
                "WALLED (attestation)"
            } else if err.contains("Reload") {
                "RELOAD-REQUIRED"
            } else if last_seq_ok >= 8 {
                "SUSTAINED"
            } else if err.is_empty() && st.done {
                "COMPLETED-EARLY"
            } else {
                "STALLED"
            };
            println!(
                "  -> {verdict} | segs_ok={} max_seq={} bytes={} reqs={} protection={} done={} err={:?}",
                last_seq_ok,
                st.audio_max_seq,
                st.bytes_used,
                st.request_count,
                st.last_protection_status,
                st.done,
                st.last_error
            );
            println!();
            engine.cancel();
        }
    }
}

#[cfg(test)]
mod ladder_decisions {
    use super::*;
    use serde_json::json;

    fn adaptive(mime: &str, url: Option<&str>) -> Value {
        let mut format = json!({ "itag": 137, "mimeType": mime, "bitrate": 1000 });
        if mime.starts_with("video/") {
            format["qualityLabel"] = json!("1080p");
            format["height"] = json!(1080);
        }
        if let Some(url) = url {
            format["url"] = json!(url);
        }
        format
    }

    #[test]
    fn ciphered_only_formats_are_not_a_win() {
        // ANDROID's usual answer: OK, but nothing carries a fetchable URL.
        let streaming_data = json!({
            "adaptiveFormats": [adaptive("video/mp4; codecs=\"avc1\"", None), adaptive("audio/mp4; codecs=\"mp4a\"", None)],
        });
        assert!(!has_playable_direct_streams(&streaming_data, "video"));
    }

    #[test]
    fn unsolved_n_urls_are_not_a_win() {
        let throttled = "https://rr1.googlevideo.com/videoplayback?expire=1&n=abc";
        let streaming_data = json!({
            "adaptiveFormats": [
                adaptive("video/mp4; codecs=\"avc1\"", Some(throttled)),
                adaptive("audio/mp4; codecs=\"mp4a\"", Some(throttled)),
            ],
        });
        assert!(!has_playable_direct_streams(&streaming_data, "video"));
    }

    #[test]
    fn direct_video_with_separate_audio_is_a_win() {
        let clean = "https://rr1.googlevideo.com/videoplayback?expire=1&c=VISIONOS";
        let streaming_data = json!({
            "adaptiveFormats": [
                adaptive("video/mp4; codecs=\"avc1\"", Some(clean)),
                adaptive("audio/mp4; codecs=\"mp4a\"", Some(clean)),
            ],
        });
        assert!(has_playable_direct_streams(&streaming_data, "video"));
    }

    #[test]
    fn video_without_any_audio_is_not_a_win() {
        let clean = "https://rr1.googlevideo.com/videoplayback?expire=1&c=VISIONOS";
        let streaming_data = json!({
            "adaptiveFormats": [adaptive("video/mp4; codecs=\"avc1\"", Some(clean))],
        });
        assert!(!has_playable_direct_streams(&streaming_data, "video"));
    }

    #[test]
    fn a_manifest_beside_adaptive_formats_needs_a_live_signal() {
        let vod = json!({ "streamingData": {
            "hlsManifestUrl": "https://manifest",
            "adaptiveFormats": [adaptive("video/mp4; codecs=\"avc1\"", None)]
        } });
        assert!(
            !has_live_manifest(&vod),
            "VISIONOS sends HLS for plain videos too"
        );
        let mut live = vod.clone();
        live["videoDetails"] = json!({ "isLive": true });
        assert!(has_live_manifest(&live));
        let mut dvr = vod.clone();
        dvr["videoDetails"] = json!({ "isPostLiveDvr": true });
        assert!(has_live_manifest(&dvr));
        let manifest_only = json!({ "streamingData": { "hlsManifestUrl": "https://manifest" } });
        assert!(has_live_manifest(&manifest_only));
    }
}

// Live checks of the client ladder against YouTube. Ignored by default; run with:
//   FLOW_LADDER_VIDEO=eWKY0OnPByg cargo test --lib ladder_live -- --ignored --nocapture
#[cfg(test)]
mod ladder_live {
    use super::*;
    use crate::streaming::sabr::SabrTrack;
    use crate::streaming::sabr::engine::{SabrEngine, SabrEngineConfig};
    use std::sync::Arc;

    fn video_id() -> String {
        std::env::var("FLOW_LADDER_VIDEO").unwrap_or_else(|_| "eWKY0OnPByg".to_string())
    }

    fn fresh_client() -> InnertubeClient {
        InnertubeClient::new()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "hits the network"]
    async fn ladder_live_cold_start_resolves() {
        let client = fresh_client();
        let info = client
            .get_stream_info(&video_id(), false)
            .await
            .expect("a cold start must resolve");
        println!(
            "variants={} audio={} sabr_available={:?}",
            info.variants.len(),
            info.audio_tracks.len(),
            info.sabr.as_ref().map(|sabr| sabr.available)
        );
        assert!(
            info.variants.iter().any(|variant| variant.is_playable)
                || info.sabr.as_ref().is_some_and(|sabr| sabr.available)
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "hits the network + botguard + nsig sidecars"]
    async fn ladder_live_each_client() {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_test_writer()
            .try_init();
        let client = fresh_client();
        let video_id = video_id();
        let visitor_data = client.fetch_visitor_data().await;
        for candidate in PLAYER_CLIENT_LADDER {
            let outcome = client
                .attempt_client(&video_id, candidate, visitor_data.as_deref())
                .await;
            let verdict = match &outcome {
                ClientOutcome::Won(_) => "playable".to_string(),
                ClientOutcome::Refused(refusal) => {
                    format!("refused: {}", map_playability_error(&refusal.playability))
                }
                ClientOutcome::Unusable => "unusable".to_string(),
            };
            println!("{:<16} {:<9} {verdict}", candidate.name, candidate.version);

            // A web client's win is a SABR session; prove media flows from it.
            let ClientOutcome::Won(attempt) = outcome else {
                continue;
            };
            if !candidate.accepts_web_po_token() {
                continue;
            }
            let streaming_data = &attempt.response["streamingData"];
            let (_, descriptor) = build_sabr_metadata(
                &attempt.response,
                streaming_data,
                &video_id,
                attempt.visitor_data.clone(),
                attempt.po_token.clone(),
                candidate,
                extract_duration_seconds_from_player_response(&attempt.response),
            );
            let descriptor = descriptor.expect("a web win carries a SABR session");
            let selected = select_formats(&descriptor.formats, None, CodecSupport::default())
                .expect("selectable formats");
            let engine = Arc::new(SabrEngine::new(
                video_id.clone(),
                descriptor,
                selected,
                SabrEngineConfig {
                    segment_wait: std::time::Duration::from_secs(30),
                    ..Default::default()
                },
            ));
            engine.clone().spawn();
            engine
                .wait_timing(std::time::Duration::from_secs(30))
                .await
                .expect("SABR session opens");
            let first = engine.get_segment(SabrTrack::Video, 1).await;
            println!(
                "    SABR first video segment: {:?}",
                first.as_ref().map(Vec::len).map_err(ToString::to_string)
            );
            engine.cancel();
            assert!(first.is_ok(), "{} SABR must deliver media", candidate.name);
        }
    }
}

#[cfg(test)]
mod remote_signing {
    use super::*;
    use serde_json::json;

    fn start_ad(skip_offset: &Value) -> Value {
        json!({ "adPlacementRenderer": {
            "config": { "adPlacementConfig": { "kind": "AD_PLACEMENT_KIND_START" } },
            "renderer": { "instreamVideoAdRenderer": { "skipOffsetMilliseconds": skip_offset } }
        }})
    }

    #[test]
    fn a_start_ad_holds_the_streams_for_most_of_its_skip_offset() {
        assert_eq!(
            preroll_wait(&json!([start_ad(&json!(5000))])),
            Duration::from_millis(4000)
        );
        assert_eq!(
            preroll_wait(&json!([start_ad(&json!("5000"))])),
            Duration::from_millis(4000)
        );
        assert_eq!(
            preroll_wait(&json!([start_ad(&json!(60000))])),
            Duration::from_secs(8)
        );
        // An unskippable ad says no offset, so the full cap applies.
        assert_eq!(
            preroll_wait(&json!([start_ad(&Value::Null)])),
            Duration::from_secs(8)
        );
    }

    #[test]
    fn the_tallest_video_format_counts_with_or_without_a_url() {
        let streaming = json!({
            "formats": [{ "mimeType": "video/mp4", "height": 360, "url": "https://a" }],
            "adaptiveFormats": [
                { "mimeType": "video/webm", "height": 1080 },
                { "mimeType": "audio/webm", "height": 4320 }
            ]
        });
        assert_eq!(max_video_height(&streaming), 1080);
        assert_eq!(max_video_height(&Value::Null), 0);
    }

    #[test]
    fn only_start_ads_hold_the_streams() {
        let mid_roll = json!({ "adPlacementRenderer": {
            "config": { "adPlacementConfig": { "kind": "AD_PLACEMENT_KIND_MILLISECONDS" } }
        }});
        assert_eq!(preroll_wait(&json!([mid_roll])), Duration::ZERO);
        assert_eq!(preroll_wait(&Value::Null), Duration::ZERO);
    }

    #[test]
    fn a_signed_format_becomes_a_url_with_its_signature_and_solved_n() {
        let format = json!({
            "signatureCipher": "s=SIGNED&sp=sig&url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback%3Fitag%3D251%26n%3Draw%26expire%3D9"
        });
        let cipher = signed_format(&format).expect("cipher parses");
        assert_eq!(cipher.signature, "SIGNED");
        assert_eq!(cipher.parameter, "sig");
        let signed = cipher.signed_url("plain").expect("base URL parses");
        let solved_n = HashMap::from([("raw".to_string(), "solved".to_string())]);
        let url = with_solved_n(&signed, &solved_n).expect("n was solved");
        assert_eq!(
            url,
            "https://rr1.googlevideo.com/videoplayback?itag=251&n=solved&expire=9&sig=plain"
        );
        assert!(remote_decoder::was_solved(&url));
    }

    #[test]
    fn a_url_whose_n_was_not_solved_is_left_alone() {
        let url = "https://rr1.googlevideo.com/videoplayback?n=raw";
        assert!(with_solved_n(url, &HashMap::new()).is_none());
        let plain = "https://rr1.googlevideo.com/videoplayback?itag=18";
        assert_eq!(
            with_solved_n(plain, &HashMap::new()).as_deref(),
            Some(plain)
        );
        let format = json!({ "signatureCipher": "s=SIGNED&url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback" });
        assert_eq!(
            signed_format(&format).expect("cipher parses").parameter,
            "signature"
        );
    }
}
