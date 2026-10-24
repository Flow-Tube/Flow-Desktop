//! Single source of truth for YouTube Music InnerTube constants.
//!
//! Centralizing these here means the inevitable YouTube param/version churn is a
//! one-file edit. Auth-gated constants are intentionally omitted (the anonymous
//! build does not use them).

/// YouTube Music origin / referer / API base.
pub const ORIGIN: &str = "https://music.youtube.com";
pub const REFERER: &str = "https://music.youtube.com/";
pub const MUSIC_BASE: &str = "https://music.youtube.com/youtubei/v1/";

// --- Browse ids -----------------------------------------------------------
pub const BROWSE_HOME: &str = "FEmusic_home";
#[allow(dead_code)]
pub const BROWSE_EXPLORE: &str = "FEmusic_explore";
pub const BROWSE_CHARTS: &str = "FEmusic_charts";
pub const CHARTS_PARAMS: &str = "ggMGCgQIgAQ%3D";
pub const BROWSE_NEW_RELEASES: &str = "FEmusic_new_releases_albums";
pub const BROWSE_MOODS: &str = "FEmusic_moods_and_genres";

/// Search filters: the canonical name, the stable prefix that names the filter
/// inside any generation of its `params`, and the params the site's own chips
/// send today.
const SEARCH_FILTERS: [(&str, &str, &str); 9] = [
    ("songs", "EgWKAQII", "EgWKAQIIAWoSEAUQAxAJEAQQChAQEBUQDhAR"),
    ("videos", "EgWKAQIQ", "EgWKAQIQAWoSEAUQAxAJEAQQChAQEBUQDhAR"),
    ("albums", "EgWKAQIY", "EgWKAQIYAWoSEAUQAxAJEAQQChAQEBUQDhAR"),
    (
        "artists",
        "EgWKAQIg",
        "EgWKAQIgAWoSEAUQAxAJEAQQChAQEBUQDhAR",
    ),
    (
        "featured_playlists",
        "EgeKAQQoADgB",
        "EgeKAQQoADgBahIQBRADEAkQBBAKEBAQFRAOEBE%3D",
    ),
    (
        "community_playlists",
        "EgeKAQQoAEAB",
        "EgeKAQQoAEABahIQBRADEAkQBBAKEBAQFRAOEBE%3D",
    ),
    (
        "podcasts",
        "EgWKAQJQ",
        "EgWKAQJQAWoSEAUQAxAJEAQQChAQEBUQDhAR",
    ),
    (
        "episodes",
        "EgWKAQJI",
        "EgWKAQJIAWoSEAUQAxAJEAQQChAQEBUQDhAR",
    ),
    (
        "profiles",
        "EgWKAQJY",
        "EgWKAQJYAWoSEAUQAxAJEAQQChAQEBUQDhAR",
    ),
];

/// Search filter `params`. Accepts singular and plural spellings, and
/// "playlists" for community playlists, so callers can pass UI labels.
#[must_use]
pub fn search_filter_params(filter: &str) -> Option<&'static str> {
    let filter = filter.trim().to_ascii_lowercase();
    let canonical = match filter.as_str() {
        "song" => "songs",
        "video" => "videos",
        "album" => "albums",
        "artist" => "artists",
        "featured" => "featured_playlists",
        "playlists" | "playlist" => "community_playlists",
        "podcast" => "podcasts",
        "episode" => "episodes",
        "profile" => "profiles",
        other => other,
    };
    SEARCH_FILTERS
        .iter()
        .find(|(name, _, _)| *name == canonical)
        .map(|(_, _, params)| *params)
}

/// The filter a chip's `params` select, whatever their generation.
#[must_use]
pub fn search_filter_of_params(params: &str) -> Option<&'static str> {
    SEARCH_FILTERS
        .iter()
        .find(|(_, prefix, _)| params.starts_with(prefix))
        .map(|(name, _, _)| *name)
}

/// A podcast's playlist id from its show page id (`MPSPPL…` → `PL…`).
#[must_use]
pub fn podcast_playlist_id(browse_id: &str) -> &str {
    browse_id.strip_prefix("MPSP").unwrap_or(browse_id)
}

/// Prefix a raw playlist id with `VL` for the `browse` endpoint (idempotent).
#[must_use]
pub fn vl(playlist_id: &str) -> String {
    if playlist_id.starts_with("VL") {
        playlist_id.to_string()
    } else {
        format!("VL{playlist_id}")
    }
}

/// Strip a leading `VL` from a playlist browse id.
#[must_use]
pub fn unvl(id: &str) -> &str {
    id.strip_prefix("VL").unwrap_or(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chip_is_named_by_its_params_in_any_generation() {
        assert_eq!(
            search_filter_of_params("EgWKAQJIAWoKEAkQChAFEAMQBA%3D%3D"),
            Some("episodes")
        );
        assert_eq!(
            search_filter_of_params("EgWKAQJYAWoSEAUQAxAJEAQQChAQEBUQDhAR"),
            Some("profiles")
        );
        assert_eq!(
            search_filter_params("playlists"),
            search_filter_params("community_playlists")
        );
        assert_eq!(podcast_playlist_id("MPSPPLYWnygD"), "PLYWnygD");
    }
}
