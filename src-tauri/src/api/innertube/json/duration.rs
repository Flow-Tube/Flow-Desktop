//! Durations as badges and rows write them: "3:00:22", "4:05", "0:59".

/// Seconds in an `h:mm:ss` or `m:ss` duration, or none when it is not one, such
/// as "LIVE", "SHORTS" or a year in a music row's subtitle.
#[must_use]
pub fn parse_duration(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    parts.iter().try_fold(0u64, |total, part| {
        part.trim()
            .parse::<u64>()
            .ok()
            .map(|value| total * 60 + value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badges() {
        assert_eq!(parse_duration("3:00:22"), Some(10_822));
        assert_eq!(parse_duration("4:05"), Some(245));
        assert_eq!(parse_duration("0:59"), Some(59));
        assert_eq!(parse_duration("2025"), None);
        assert_eq!(parse_duration("LIVE"), None);
        assert_eq!(parse_duration(""), None);
        assert_eq!(parse_duration("1::2"), None);
    }
}
