//! How much louder than the site's target a stream plays, in dB.

use serde_json::Value;

/// The loudness of a stream relative to the target, from the player answer's
/// `audioConfig` or the audio format itself.
///
/// `VISIONOS` sends no top-level `loudnessDb`, only a per-format one and the
/// perceptual loudness with its target, so each is tried in turn.
#[must_use]
pub fn loudness_db(audio_config: &Value, format: &Value) -> Option<f64> {
    audio_config["loudnessDb"]
        .as_f64()
        .or_else(|| format["loudnessDb"].as_f64())
        .or_else(|| {
            let perceptual = audio_config["perceptualLoudnessDb"].as_f64()?;
            let target = audio_config["loudnessTargetLkfs"].as_f64()?;
            Some(perceptual - target)
        })
}

/// The target the site measures perceptual loudness against when the answer leaves it out.
const DEFAULT_TARGET_LKFS: f64 = -14.0;

/// Music's loudness in Flow for Android's order (`LoudnessGain`): the perceptual loudness
/// against its target first, then the answer's `loudnessDb`, then the format's own. The
/// perceptual value is measured the way a listener hears the song, so it is preferred.
#[must_use]
pub fn music_loudness_db(audio_config: &Value, format: &Value) -> Option<f64> {
    audio_config["perceptualLoudnessDb"]
        .as_f64()
        .map(|perceptual| {
            perceptual
                - audio_config["loudnessTargetLkfs"]
                    .as_f64()
                    .unwrap_or(DEFAULT_TARGET_LKFS)
        })
        .or_else(|| audio_config["loudnessDb"].as_f64())
        .or_else(|| format["loudnessDb"].as_f64())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Ported from Android's LoudnessGainTest, in loudness rather than gain.
    #[test]
    fn music_loudness_prefers_the_perceptual_value_against_its_target() {
        assert_eq!(
            music_loudness_db(
                &json!({ "loudnessDb": 9.0, "perceptualLoudnessDb": -8.0 }),
                &json!({})
            ),
            Some(6.0)
        );
        assert_eq!(
            music_loudness_db(
                &json!({ "perceptualLoudnessDb": -10.0, "loudnessTargetLkfs": -16.0 }),
                &json!({})
            ),
            Some(6.0)
        );
        assert_eq!(
            music_loudness_db(&json!({ "loudnessDb": 4.5 }), &json!({ "loudnessDb": 9.0 })),
            Some(4.5)
        );
        assert_eq!(
            music_loudness_db(&json!({}), &json!({ "loudnessDb": 3.0 })),
            Some(3.0)
        );
        assert_eq!(music_loudness_db(&json!({}), &json!({})), None);
    }

    #[test]
    fn loudness_comes_from_the_config_the_format_or_the_perceptual_target() {
        assert_eq!(
            loudness_db(&json!({ "loudnessDb": 3.5 }), &json!({})),
            Some(3.5)
        );
        assert_eq!(
            loudness_db(&json!({}), &json!({ "loudnessDb": -2.0 })),
            Some(-2.0)
        );
        assert_eq!(
            loudness_db(
                &json!({ "perceptualLoudnessDb": -9.0, "loudnessTargetLkfs": -14.0 }),
                &json!({})
            ),
            Some(5.0)
        );
        assert_eq!(loudness_db(&json!({}), &json!({})), None);
    }
}
