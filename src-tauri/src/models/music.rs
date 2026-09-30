use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub name: String,
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub name: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongItem {
    pub id: String,
    pub title: String,
    pub artists: Vec<Artist>,
    pub album: Option<Album>,
    pub duration: Option<u64>,
    pub music_video_type: Option<String>,
    pub thumbnail: String,
    pub explicit: bool,
    pub video_id: Option<String>,
    pub playlist_id: Option<String>,
    pub params: Option<String>,
    /// Play-count text (`3.4B plays`) shown in the album view's Streams column.
    #[serde(default)]
    pub views_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumItem {
    pub browse_id: String,
    pub playlist_id: String,
    pub title: String,
    pub artists: Option<Vec<Artist>>,
    pub year: Option<i32>,
    pub thumbnail: String,
    pub explicit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: String,
    pub title: String,
    pub author: Option<Artist>,
    pub song_count_text: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistItem {
    pub id: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub channel_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeItem {
    pub id: String,
    pub title: String,
    pub author: Option<Artist>,
    pub thumbnail: String,
    pub explicit: bool,
    pub publish_date_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastItem {
    pub id: String,
    pub title: String,
    pub author: Option<Artist>,
    pub episode_count_text: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum YTItem {
    Song(SongItem),
    Album(AlbumItem),
    Playlist(PlaylistItem),
    Artist(ArtistItem),
    Episode(EpisodeItem),
    Podcast(PodcastItem),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSection {
    pub title: String,
    pub items: Vec<YTItem>,
    pub more_endpoint_browse_id: Option<String>,
    pub more_endpoint_params: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistPage {
    pub artist: ArtistItem,
    pub sections: Vec<ArtistSection>,
    pub description: Option<String>,
    pub subscriber_count_text: Option<String>,
    pub monthly_listener_count: Option<String>,
    pub is_subscribed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodAndGenreItem {
    pub title: String,
    pub stripe_color: u64,
    pub browse_id: String,
    pub params: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorePage {
    pub new_release_albums: Vec<AlbumItem>,
    pub mood_and_genres: Vec<MoodAndGenreItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSection {
    pub title: String,
    pub items: Vec<YTItem>,
    pub chart_type: String, // "Trending" | "Top" | "Genre" | "NewReleases"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartsPage {
    pub sections: Vec<ChartSection>,
    pub continuation: Option<String>,
}
