use crate::api::extractor::YoutubeExtractor;
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
use async_trait::async_trait;

pub mod core;
pub mod download;
pub mod extractors;
pub mod music;
pub mod parsers;

pub struct InnertubeClient {
    pub(crate) client: reqwest::Client,
    #[allow(dead_code)]
    pub(crate) visitor_data: std::sync::RwLock<Option<String>>,
}

impl InnertubeClient {
    #[must_use]
    pub fn new(_app: &tauri::AppHandle) -> Self {
        let client = reqwest::Client::builder()
            .tls_backend_rustls()
            .pool_idle_timeout(std::time::Duration::from_secs(120))
            .pool_max_idle_per_host(15)
            .brotli(true)
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_else(|e| {
                tracing::error!(
                    "Failed to initialize high-performance reqwest client: {}",
                    e
                );
                reqwest::Client::new()
            });
        Self {
            client,
            visitor_data: std::sync::RwLock::new(None),
        }
    }
}

#[async_trait]
impl YoutubeExtractor for InnertubeClient {
    async fn search_videos(&self, request: SearchVideosRequest) -> AppResult<SearchVideosResponse> {
        self.search_videos(request).await
    }

    async fn get_video_details(&self, video_id: &str) -> AppResult<VideoDetails> {
        self.get_video_details(video_id).await
    }

    async fn get_related_videos(&self, video_id: &str) -> AppResult<Vec<RelatedContentItem>> {
        self.get_related_videos(video_id).await
    }

    async fn get_stream_info(&self, video_id: &str, refresh: bool) -> AppResult<StreamInfo> {
        self.get_stream_info(video_id, refresh).await
    }

    async fn get_channel_details(&self, channel_id: &str) -> AppResult<ChannelDetails> {
        self.get_channel_details(channel_id).await
    }

    async fn get_channel_tab(
        &self,
        channel_id: &str,
        params: Option<String>,
        page_token: Option<String>,
        query: Option<String>,
    ) -> AppResult<ChannelTabResponse> {
        self.get_channel_tab(channel_id, params, page_token, query)
            .await
    }

    async fn get_playlist_details(
        &self,
        playlist_id: &str,
        page_token: Option<String>,
    ) -> AppResult<PlaylistDetailsResponse> {
        self.get_playlist_details(playlist_id, page_token).await
    }

    async fn get_comments(
        &self,
        video_id: &str,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        self.get_comments(video_id, page_token).await
    }

    async fn get_post_comments(
        &self,
        post_id: &str,
        params: Option<String>,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        self.get_post_comments(post_id, params, page_token).await
    }

    async fn get_live_chat(
        &self,
        video_id: &str,
        continuation: Option<String>,
    ) -> AppResult<LiveChatResponse> {
        self.get_live_chat(video_id, continuation).await
    }

    async fn get_trending_videos(
        &self,
        category: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<Vec<VideoSummary>> {
        self.get_trending_videos(category, region).await
    }

    async fn get_search_suggestions(&self, query: &str) -> AppResult<Vec<String>> {
        self.get_search_suggestions(query).await
    }

    async fn get_shorts_sequence(
        &self,
        params: Option<String>,
        sequence_params: Option<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        self.get_shorts_sequence(params, sequence_params, region)
            .await
    }

    async fn search_music(&self, query: &str, filter: &str) -> AppResult<Vec<VideoSummary>> {
        self.search_music(query, filter).await
    }

    fn parse_subscription_export(&self, data: &str) -> AppResult<Vec<(String, String)>> {
        self.parse_subscription_export(data)
    }

    async fn get_music_lyrics(&self, video_id: &str) -> AppResult<Option<String>> {
        self.get_music_lyrics(video_id).await
    }

    async fn get_music_related(&self, video_id: &str) -> AppResult<Vec<VideoSummary>> {
        self.get_music_related(video_id).await
    }

    async fn get_music_album(&self, album_browse_id: &str) -> AppResult<Vec<VideoSummary>> {
        self.get_music_album(album_browse_id).await
    }

    async fn get_music_home(&self) -> AppResult<(Vec<MusicHomeSection>, Vec<MusicHomeChip>)> {
        self.get_music_home().await
    }

    async fn get_music_artist(&self, artist_browse_id: &str) -> AppResult<ArtistPage> {
        self.get_music_artist(artist_browse_id).await
    }

    async fn get_music_explore(&self) -> AppResult<ExplorePage> {
        self.get_music_explore().await
    }

    async fn get_music_charts(&self, continuation: Option<String>) -> AppResult<ChartsPage> {
        self.get_music_charts(continuation).await
    }
}
