use async_trait::async_trait;

use crate::errors::AppResult;
use crate::models::channel::{ChannelDetails, ChannelTabResponse};
use crate::models::comment::CommentsResponse;
use crate::models::live_chat::LiveChatResponse;
use crate::models::music::{ArtistPage, ChartsPage, ExplorePage};
use crate::models::playlist::PlaylistDetailsResponse;
use crate::models::search::{SearchVideosRequest, SearchVideosResponse};
use crate::models::shorts::ShortsFeed;
use crate::models::video::{
    MusicHomeChip, MusicHomeSection, RelatedContentItem, StreamInfo, VideoDetails, VideoSummary,
};

#[async_trait]
pub trait YoutubeExtractor: Send + Sync {
    async fn search_videos(&self, request: SearchVideosRequest) -> AppResult<SearchVideosResponse>;

    async fn get_video_details(&self, video_id: &str) -> AppResult<VideoDetails>;

    async fn get_related_videos(&self, video_id: &str) -> AppResult<Vec<RelatedContentItem>>;

    /// `refresh` forces a fresh `player` walk, bypassing the response reused
    /// across the other calls one video open makes.
    async fn get_stream_info(&self, video_id: &str, refresh: bool) -> AppResult<StreamInfo>;

    async fn get_channel_details(&self, channel_id: &str) -> AppResult<ChannelDetails>;

    async fn get_channel_tab(
        &self,
        channel_id: &str,
        params: Option<String>,
        page_token: Option<String>,
        query: Option<String>,
    ) -> AppResult<ChannelTabResponse>;

    async fn get_playlist_details(
        &self,
        playlist_id: &str,
        page_token: Option<String>,
    ) -> AppResult<PlaylistDetailsResponse>;

    async fn get_comments(
        &self,
        video_id: &str,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse>;

    async fn get_post_comments(
        &self,
        post_id: &str,
        params: Option<String>,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse>;

    async fn get_live_chat(
        &self,
        video_id: &str,
        continuation: Option<String>,
    ) -> AppResult<LiveChatResponse>;

    async fn get_trending_videos(
        &self,
        category: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<Vec<VideoSummary>>;

    async fn get_search_suggestions(&self, query: &str) -> AppResult<Vec<String>>;

    async fn get_shorts_sequence(
        &self,
        params: Option<String>,
        sequence_params: Option<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed>;

    async fn search_music(
        &self,
        query: &str,
        filter: &str, // "songs" | "videos" | "albums" | "playlists" | "artists"
    ) -> AppResult<Vec<VideoSummary>>;

    fn parse_subscription_export(&self, data: &str) -> AppResult<Vec<(String, String)>>;

    async fn get_music_lyrics(&self, video_id: &str) -> AppResult<Option<String>>;

    async fn get_music_related(&self, video_id: &str) -> AppResult<Vec<VideoSummary>>;

    async fn get_music_album(&self, album_browse_id: &str) -> AppResult<Vec<VideoSummary>>;

    async fn get_music_home(&self) -> AppResult<(Vec<MusicHomeSection>, Vec<MusicHomeChip>)>;

    async fn get_music_artist(&self, artist_browse_id: &str) -> AppResult<ArtistPage>;

    async fn get_music_explore(&self) -> AppResult<ExplorePage>;

    async fn get_music_charts(&self, continuation: Option<String>) -> AppResult<ChartsPage>;
}
