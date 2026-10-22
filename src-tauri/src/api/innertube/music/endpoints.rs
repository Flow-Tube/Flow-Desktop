//! Single source of truth for YouTube Music InnerTube constants.
//!
//! Centralizing these here means the inevitable YouTube param/version churn is a
//! one-file edit. Auth-gated constants are intentionally omitted (the anonymous
//! build does not use them).

/// YouTube Music origin / referer / API base.
pub const ORIGIN: &str = "https://music.youtube.com";
pub const REFERER: &str = "https://music.youtube.com/";
pub const MUSIC_BASE: &str = "https://music.youtube.com/youtubei/v1/";

/// Public API key used for the (auth-less) transcript endpoint.
#[allow(dead_code)]
pub const TRANSCRIPT_API_KEY: &str = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX3";

// --- Browse ids -----------------------------------------------------------
pub const BROWSE_HOME: &str = "FEmusic_home";
#[allow(dead_code)]
pub const BROWSE_EXPLORE: &str = "FEmusic_explore";
pub const BROWSE_CHARTS: &str = "FEmusic_charts";
pub const CHARTS_PARAMS: &str = "ggMGCgQIgAQ%3D";
pub const BROWSE_NEW_RELEASES: &str = "FEmusic_new_releases_albums";
pub const BROWSE_MOODS: &str = "FEmusic_moods_and_genres";

/// Search filter `params` strings (Metrolist's current generation).
///
/// Accepts both singular and plural spellings so callers can pass UI labels.
#[must_use]
pub fn search_filter_params(filter: &str) -> Option<&'static str> {
    match filter.trim().to_ascii_lowercase().as_str() {
        "songs" | "song" => Some("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
        "videos" | "video" => Some("EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D"),
        "albums" | "album" => Some("EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D"),
        "artists" | "artist" => Some("EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D"),
        "featured_playlists" | "featured" => Some("EgeKAQQoADgBagwQDhAKEAMQBRAJEAQ%3D"),
        "community_playlists" | "playlists" | "playlist" => Some("EgeKAQQoAEABagoQAxAEEAoQCRAF"),
        "podcasts" | "podcast" => Some("EgWKAQJQAWoKEAkQChAFEAMQBA%3D%3D"),
        "episodes" | "episode" => Some("EgWKAQJIAWoKEAkQChAFEAMQBA%3D%3D"),
        _ => None,
    }
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
