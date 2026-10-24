//! Seek-bar preview frames: the player answer's storyboard spec, parsed into
//! its levels of sprite sheets.
//!
//! The spec is a URL template followed by one `|`-separated group per level,
//! `width#height#count#columns#rows#interval#name#sigh`. A level's sheet URL
//! is the template with `$L` as the level's index and `$N` as its name, plus
//! its `sigh`; `$M` in the name numbers the sheets.

use serde_json::Value;

use crate::models::video::StoryboardLevel;

#[must_use]
pub fn parse_storyboard(player: &Value, duration_seconds: Option<u64>) -> Vec<StoryboardLevel> {
    player["storyboards"]["playerStoryboardSpecRenderer"]["spec"]
        .as_str()
        .map(|spec| parse_spec(spec, duration_seconds))
        .unwrap_or_default()
}

fn parse_spec(spec: &str, duration_seconds: Option<u64>) -> Vec<StoryboardLevel> {
    let mut parts = spec.split('|');
    let Some(base) = parts.next().filter(|base| !base.is_empty()) else {
        return Vec::new();
    };
    let base = if base.starts_with("http") {
        base.to_string()
    } else {
        format!("https://i.ytimg.com/{}", base.trim_start_matches('/'))
    };
    parts
        .enumerate()
        .filter_map(|(index, level)| {
            let fields: Vec<&str> = level.split('#').collect();
            let [width, height, count, columns, rows, interval, name, sigh] = fields.as_slice()
            else {
                return None;
            };
            let number = |text: &str| text.parse::<u32>().ok().filter(|value| *value > 0);
            let count = number(count)?;
            // An interval of 0 spreads the frames evenly over the whole video.
            let interval_ms = interval
                .parse::<u64>()
                .ok()
                .filter(|ms| *ms > 0)
                .or_else(|| duration_seconds.map(|seconds| seconds * 1000 / u64::from(count)))
                .filter(|ms| *ms > 0)?;
            Some(StoryboardLevel {
                width: number(width)?,
                height: number(height)?,
                count,
                columns: number(columns)?,
                rows: number(rows)?,
                interval_ms,
                url_template: format!(
                    "{}&sigh={sigh}",
                    base.replace("$L", &index.to_string()).replace("$N", name)
                ),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SPEC: &str = "https://i.ytimg.com/sb/abc/storyboard3_L$L/$N.jpg?sqp=xyz|48#27#100#10#10#0#default#rs$AAA|80#45#61#10#10#2000#M$M#rs$BBB|160#90#61#5#5#2000#M$M#rs$CCC";

    #[test]
    fn each_level_gets_its_sheet_url_and_frame_interval() {
        let levels = parse_storyboard(
            &json!({ "storyboards": { "playerStoryboardSpecRenderer": { "spec": SPEC } } }),
            Some(120),
        );
        assert_eq!(levels.len(), 3);
        assert_eq!(
            levels[0].interval_ms, 1200,
            "an interval of 0 spreads 100 frames over 120 s"
        );
        assert_eq!(
            levels[0].url_template,
            "https://i.ytimg.com/sb/abc/storyboard3_L0/default.jpg?sqp=xyz&sigh=rs$AAA"
        );
        let largest = &levels[2];
        assert_eq!(
            (largest.width, largest.height, largest.columns, largest.rows),
            (160, 90, 5, 5)
        );
        assert_eq!(largest.interval_ms, 2000);
        assert_eq!(
            largest.url_template,
            "https://i.ytimg.com/sb/abc/storyboard3_L2/M$M.jpg?sqp=xyz&sigh=rs$CCC"
        );
    }

    #[test]
    fn a_missing_or_broken_spec_gives_no_previews() {
        assert!(parse_storyboard(&json!({}), Some(60)).is_empty());
        assert!(parse_spec("https://x/$L|bad#level", Some(60)).is_empty());
        assert!(parse_spec("https://x/$L/$N|48#27#100#10#10#0#default#s", None).is_empty());
    }
}
