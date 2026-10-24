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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
