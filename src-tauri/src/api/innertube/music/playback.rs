//! Multi-client audio stream resolver for YouTube Music.
//!
//! This is the desktop counterpart of `FlowApp_mobile`'s
//! `MusicPlayerUtils.fetchPlaybackData`: it walks an ordered list of InnerTube
//! clients ([`clients::DIRECT_AUDIO_CLIENTS`]) until one returns a directly
//! playable audio stream. Unlike mobile, the desktop has no JS cipher/n-sig
//! solver, so the loop only accepts formats that expose a clean `url` (no
//! unsolved `n` throttle parameter); clients that only return `signatureCipher`
//! are skipped and the loop falls through to the next one — "trying every client
//! so all music is fetched".
//!
//! It is completely independent of the video extractor's `get_stream_info`.

use std::time::Duration;

use serde_json::Value;
use tracing::{debug, info, warn};

use super::clients;
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::botguard::generate_po_token;
use crate::api::innertube::extractors::player::{
    is_bot_wall, is_reportable_refusal, map_playability_error, playback_priority,
};
use crate::errors::{AppError, AppResult};
use crate::models::music_stream::{MusicAudioQuality, MusicStreamInfo};

/// How long one client gets before the resolver moves on. Without it a single
/// stalled request left the player spinning for as long as the socket lived.
const MUSIC_CLIENT_TIMEOUT: Duration = Duration::from_secs(6);

/// What one client answered for a track.
enum ClientAnswer {
    Playable(Box<MusicStreamInfo>),
    Refused(Value),
    Unusable,
}

impl InnertubeClient {
    /// Resolve a playable, audio-only stream for a music `video_id` by trying
    /// each direct-audio client in turn. Returns the raw upstream URL + the
    /// User-Agent that must fetch it; the command layer proxies it.
    ///
    /// Follows the video ladder's rules: the first bot wall is retried once
    /// under a fresh visitor identity, and a refusal that belongs to the track
    /// itself (region, privacy, removal) ends the walk, since every client would
    /// give the same answer.
    pub(crate) async fn resolve_music_stream(
        &self,
        video_id: &str,
        audio_quality: MusicAudioQuality,
    ) -> AppResult<MusicStreamInfo> {
        let video_id = video_id.trim();
        if video_id.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        // Bulk metadata lookups wait while a track is being resolved.
        let _priority = playback_priority().start_stream();
        let mut visitor = self.music_visitor_data().await;
        let mut identity_refreshed = false;
        let mut last_error: Option<AppError> = None;

        for client in clients::DIRECT_AUDIO_CLIENTS {
            let mut answer = self
                .ask_music_client(client, video_id, audio_quality, visitor.as_deref())
                .await;
            if !identity_refreshed
                && matches!(&answer, ClientAnswer::Refused(playability) if is_bot_wall(playability))
            {
                identity_refreshed = true;
                if let Some(fresh) = self.refresh_visitor_data().await {
                    info!(
                        client = client.name,
                        "Music bot wall; retrying under a fresh visitor identity"
                    );
                    visitor = Some(fresh);
                    answer = self
                        .ask_music_client(client, video_id, audio_quality, visitor.as_deref())
                        .await;
                }
            }

            match answer {
                ClientAnswer::Playable(info) => return Ok(*info),
                ClientAnswer::Refused(playability) => {
                    let error = music_refusal_error(&playability);
                    warn!(client = client.name, reason = %error, "non-OK music playability");
                    let track_level =
                        is_reportable_refusal(&playability) && !is_bot_wall(&playability);
                    last_error = Some(error);
                    if track_level {
                        break;
                    }
                }
                ClientAnswer::Unusable => {}
            }
        }

        Err(last_error.unwrap_or_else(|| {
            AppError::Extractor(format!(
                "Failed to resolve music stream for {video_id} after trying all clients"
            ))
        }))
    }

    async fn ask_music_client(
        &self,
        client: &clients::MusicClient,
        video_id: &str,
        audio_quality: MusicAudioQuality,
        visitor: Option<&str>,
    ) -> ClientAnswer {
        // Only a client Flow can attest gets a token, and it is bound to the same
        // visitor data the request carries.
        let po_token = if client.use_web_po_tokens {
            generate_po_token(visitor.unwrap_or(video_id)).await
        } else {
            None
        };
        let sts = client.signature_timestamp();

        let res = match tokio::time::timeout(
            MUSIC_CLIENT_TIMEOUT,
            self.music_player(client, video_id, sts, po_token.as_deref(), visitor),
        )
        .await
        {
            Ok(Ok(res)) => res,
            Ok(Err(error)) => {
                debug!(client = client.name, %error, "music client request failed");
                return ClientAnswer::Unusable;
            }
            Err(_) => {
                warn!(client = client.name, "music client request timed out");
                return ClientAnswer::Unusable;
            }
        };

        let status = res["playabilityStatus"]["status"].as_str().unwrap_or("");
        if !status.eq_ignore_ascii_case("OK") {
            return ClientAnswer::Refused(res["playabilityStatus"].clone());
        }

        let streaming = &res["streamingData"];
        let Some((format, url)) = pick_audio_format(streaming, audio_quality) else {
            debug!(client = client.name, "no clean direct audio format");
            return ClientAnswer::Unusable;
        };

        let mime_type = format["mimeType"]
            .as_str()
            .unwrap_or("audio/webm")
            .to_string();
        let itag = format["itag"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(0);
        let bitrate = format["bitrate"]
            .as_u64()
            .or_else(|| format["averageBitrate"].as_u64());
        let approx_duration_ms = format["approxDurationMs"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok());
        let loudness_db = res["playerConfig"]["audioConfig"]["loudnessDb"].as_f64();
        let perceptual_loudness_db =
            res["playerConfig"]["audioConfig"]["perceptualLoudnessDb"].as_f64();
        let expires_in_seconds = streaming["expiresInSeconds"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(21600);

        info!(
            client = client.name,
            itag,
            ?bitrate,
            audio_quality = audio_quality.as_str(),
            "music stream resolved"
        );

        ClientAnswer::Playable(Box::new(MusicStreamInfo {
            video_id: video_id.to_string(),
            audio_url: url,
            mime_type,
            itag,
            bitrate,
            approx_duration_ms,
            loudness_db,
            perceptual_loudness_db,
            expires_in_seconds,
            used_client: client.name.to_string(),
            user_agent: client.user_agent.to_string(),
        }))
    }
}

/// True when the URL has no unsolved `n` throttling parameter (desktop cannot
/// deobfuscate it, so such URLs would be throttled to uselessness).
fn url_is_clean(url: &str) -> bool {
    reqwest::Url::parse(url)
        .map(|u| !u.query_pairs().any(|(k, v)| k == "n" && !v.is_empty()))
        .unwrap_or(false)
}

#[derive(Debug, Clone)]
struct AudioCandidate {
    format: Value,
    url: String,
    bitrate: u64,
    score: i64,
    is_original: bool,
}

fn format_bitrate(format: &Value) -> u64 {
    format["averageBitrate"]
        .as_u64()
        .filter(|b| *b > 0)
        .or_else(|| format["bitrate"].as_u64())
        .unwrap_or(0)
}

fn format_is_original_audio(format: &Value) -> bool {
    let track = &format["audioTrack"];
    track.is_null() || track["audioIsDefault"].as_bool() == Some(true)
}

fn codec_bonus(format: &Value) -> i64 {
    let mime = format["mimeType"].as_str().unwrap_or("");
    if mime.contains("webm") || mime.contains("opus") {
        10_240
    } else {
        0
    }
}

/// Quality score: bitrate, with a bonus for Opus/WebM and a large bonus for the
/// original (non-dubbed) track. Mirrors mobile's `audioQualityScore` plus an
/// original-language preference.
fn audio_score(format: &Value) -> i64 {
    let bitrate = i64::try_from(format_bitrate(format)).unwrap_or(0);
    let original_bonus = if format_is_original_audio(format) {
        1_000_000
    } else {
        0
    };
    bitrate + codec_bonus(format) + original_bonus
}

fn better_targeted_candidate(
    candidate: &AudioCandidate,
    current: &AudioCandidate,
    target_bitrate: u64,
    max_preferred_bitrate: u64,
) -> bool {
    let candidate_in_cap = candidate.bitrate > 0 && candidate.bitrate <= max_preferred_bitrate;
    let current_in_cap = current.bitrate > 0 && current.bitrate <= max_preferred_bitrate;

    match (candidate_in_cap, current_in_cap) {
        (true, false) => true,
        (false, true) => false,
        (false, false) => {
            if candidate.bitrate == current.bitrate {
                candidate.score > current.score
            } else if candidate.bitrate == 0 {
                false
            } else if current.bitrate == 0 {
                true
            } else {
                candidate.bitrate < current.bitrate
            }
        }
        (true, true) => {
            let candidate_distance = candidate.bitrate.abs_diff(target_bitrate);
            let current_distance = current.bitrate.abs_diff(target_bitrate);
            candidate_distance < current_distance
                || (candidate_distance == current_distance && candidate.score > current.score)
        }
    }
}

fn pick_targeted_quality(
    candidates: &[AudioCandidate],
    target_bitrate: u64,
    max_preferred_bitrate: u64,
) -> Option<&AudioCandidate> {
    let mut preferred: Vec<&AudioCandidate> = candidates.iter().filter(|c| c.is_original).collect();
    if preferred.is_empty() {
        preferred = candidates.iter().collect();
    }

    preferred
        .into_iter()
        .fold(None, |best, candidate| match best {
            None => Some(candidate),
            Some(current)
                if better_targeted_candidate(
                    candidate,
                    current,
                    target_bitrate,
                    max_preferred_bitrate,
                ) =>
            {
                Some(candidate)
            }
            Some(current) => Some(current),
        })
}

/// Choose a directly-playable audio-only format. Returns `(format, url)`.
fn pick_audio_format(
    streaming: &Value,
    audio_quality: MusicAudioQuality,
) -> Option<(Value, String)> {
    let formats = streaming["adaptiveFormats"].as_array()?;
    let mut candidates: Vec<AudioCandidate> = Vec::new();

    for format in formats {
        let mime = format["mimeType"].as_str().unwrap_or("");
        if !mime.starts_with("audio/") {
            continue;
        }
        let Some(url) = format["url"].as_str() else {
            continue; // ciphered-only — skip (no solver on desktop)
        };
        if !url_is_clean(url) {
            continue;
        }

        candidates.push(AudioCandidate {
            format: format.clone(),
            url: url.to_string(),
            bitrate: format_bitrate(format),
            score: audio_score(format),
            is_original: format_is_original_audio(format),
        });
    }

    let selected = match audio_quality {
        MusicAudioQuality::Auto => candidates.iter().max_by_key(|candidate| candidate.score),
        MusicAudioQuality::High => candidates
            .iter()
            .filter(|candidate| candidate.is_original)
            .max_by_key(|candidate| (candidate.bitrate, candidate.score))
            .or_else(|| {
                candidates
                    .iter()
                    .max_by_key(|candidate| (candidate.bitrate, candidate.score))
            }),
        MusicAudioQuality::Medium => pick_targeted_quality(&candidates, 128_000, 160_000),
        MusicAudioQuality::Low => pick_targeted_quality(&candidates, 64_000, 96_000),
    }?;

    Some((selected.format.clone(), selected.url.clone()))
}

/// The video ladder's classification, plus the Premium wording the music
/// service uses that the video path does not look for.
fn music_refusal_error(playability: &Value) -> AppError {
    let reason = playability["reason"].as_str().unwrap_or_default();
    if reason.to_ascii_lowercase().contains("premium") {
        return AppError::MusicPremium("This track requires YouTube Music Premium".into());
    }
    map_playability_error(playability)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn premium_wording_is_reported_as_music_premium() {
        let playability = json!({
            "status": "UNPLAYABLE",
            "reason": "This track is only available to Music Premium members",
        });
        assert!(matches!(
            music_refusal_error(&playability),
            AppError::MusicPremium(_)
        ));
    }

    #[test]
    fn region_and_removal_keep_their_own_kinds() {
        let region = json!({
            "status": "UNPLAYABLE",
            "reason": "This video is not available in your country",
        });
        assert!(matches!(
            music_refusal_error(&region),
            AppError::GeographicRestriction(_)
        ));
        let removed = json!({ "status": "ERROR", "reason": "This video is unavailable" });
        assert!(matches!(
            music_refusal_error(&removed),
            AppError::ContentNotAvailable(_)
        ));
        assert!(is_reportable_refusal(&removed));
    }

    #[test]
    fn audio_picker_skips_throttled_and_ciphered_formats() {
        let streaming = json!({
            "adaptiveFormats": [
                { "itag": 251, "mimeType": "audio/webm; codecs=\"opus\"", "bitrate": 150_000,
                  "url": "https://rr1.googlevideo.com/videoplayback?n=abc" },
                { "itag": 140, "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"", "bitrate": 130_000,
                  "signatureCipher": "s=x&url=y" },
                { "itag": 139, "mimeType": "audio/mp4; codecs=\"mp4a.40.5\"", "bitrate": 50000,
                  "url": "https://rr1.googlevideo.com/videoplayback?c=VISIONOS" },
            ],
        });
        let (format, _) =
            pick_audio_format(&streaming, MusicAudioQuality::Auto).expect("one clean format");
        assert_eq!(format["itag"], 139);
    }
}
