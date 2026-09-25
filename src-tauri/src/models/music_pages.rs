//! Typed page/response models for the YouTube Music subsystem.
//!
//! These compose the existing item types in [`crate::models::music`]
//! (`YTItem`, `SongItem`, `AlbumItem`, …) into full page responses with
//! first-class `continuation` tokens — the breadth the legacy
//! `extractors/music.rs` lacked. They are additive: nothing here changes the
//! existing video models or the existing music commands.

use serde::{Deserialize, Serialize};

use crate::models::music::{AlbumItem, Artist, ArtistItem, PlaylistItem, SongItem, YTItem};
use crate::models::video::MusicHomeChip;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// A titled group of search results (e.g. "Songs", "Albums", "Artists").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSearchSection {
    pub title: String,
    pub items: Vec<YTItem>,
}

/// Result of a filtered search (`/search` with a filter param), with paging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSearchResponse {
    pub sections: Vec<MusicSearchSection>,
    pub continuation: Option<String>,
}

/// Result of a no-filter "summary" search — the first section is the
/// "top result" card, followed by per-category previews.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummaryPage {
    pub summaries: Vec<MusicSearchSection>,
}

/// A rich search suggestion: either a query string or a tappable entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSearchSuggestions {
    /// Plain text "did you mean" query completions.
    pub queries: Vec<String>,
    /// Tappable entities (songs/artists/albums/…) shown in the suggestion list.
    pub recommended_items: Vec<YTItem>,
}

// ---------------------------------------------------------------------------
// Album
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPage {
    pub album: AlbumItem,
    pub other_versions: Vec<AlbumItem>,
    pub description: Option<String>,
    pub song_count: Option<u32>,
    pub duration_text: Option<String>,
    pub songs: Vec<SongItem>,
    pub continuation: Option<String>,
}

// ---------------------------------------------------------------------------
// Playlist
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaylistPage {
    pub id: String,
    pub title: String,
    pub author: Option<Artist>,
    pub song_count_text: Option<String>,
    pub thumbnail: Option<String>,
    pub description: Option<String>,
    pub songs: Vec<SongItem>,
    pub continuation: Option<String>,
}

// ---------------------------------------------------------------------------
// Home (typed — supersedes the VideoSummary-based get_music_home)
// ---------------------------------------------------------------------------

/// A horizontal carousel / grid shelf on the music home/explore surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicShelf {
    pub title: String,
    pub subtitle: Option<String>,
    /// `moreContentButton` browse target, if the shelf has a "see all".
    pub browse_id: Option<String>,
    pub params: Option<String>,
    pub items: Vec<YTItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicHomePage {
    pub chips: Vec<MusicHomeChip>,
    pub sections: Vec<MusicShelf>,
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMusicHomePage {
    pub page: MusicHomePage,
    /// Unix timestamp in seconds, used by the UI to decide when to refresh.
    pub fetched_at: i64,
}

// ---------------------------------------------------------------------------
// Related (typed shelves preserve the source of each candidate)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelatedShelfType {
    Similar,
    Playlists,
    OtherPerformances,
    SimilarArtists,
    MoreFromArtist,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedShelf {
    pub shelf_type: RelatedShelfType,
    pub title: String,
    pub artist_browse_id: Option<String>,
    pub items: Vec<YTItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedPage {
    pub sections: Vec<RelatedShelf>,
    /// Only audio from the similar-song lane; suitable for audio recommendations.
    pub songs: Vec<SongItem>,
    pub other_performances: Vec<SongItem>,
    pub albums: Vec<AlbumItem>,
    pub artists: Vec<ArtistItem>,
    pub playlists: Vec<PlaylistItem>,
}

// ---------------------------------------------------------------------------
// Watch queue / radio (the `next` endpoint)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePage {
    pub items: Vec<SongItem>,
    pub current_index: Option<i32>,
    pub continuation: Option<String>,
    /// Browse pointer for the lyrics tab (feed to `get_music_lyrics_for`).
    pub lyrics_browse_id: Option<String>,
    pub lyrics_params: Option<String>,
    /// Browse pointer for the related tab.
    pub related_browse_id: Option<String>,
    /// Auto-radio playlist id (`RDAMVM…`) for endless play, when present.
    pub radio_playlist_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Mood / genre browse detail
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodGenrePage {
    pub title: String,
    pub items: Vec<YTItem>,
    pub continuation: Option<String>,
}
