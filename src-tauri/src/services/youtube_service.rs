use std::sync::Arc;

use crate::api::extractor::YoutubeExtractor;
use crate::errors::AppResult;
use crate::models::channel::{ChannelDetails, ChannelTabResponse};
use crate::models::comment::CommentsResponse;
use crate::models::live_chat::LiveChatResponse;
use crate::models::music::{ArtistPage, ChartsPage, ExplorePage};
use crate::models::playlist::PlaylistDetailsResponse;
use crate::models::search::{SearchVideosRequest, SearchVideosResponse};
use crate::models::shorts::ShortsFeed;
use crate::models::video::{MusicHomeChip, MusicHomeSection, VideoSummary};
use crate::models::video::{RelatedContentItem, StreamInfo, VideoDetails};

#[derive(Clone)]
pub struct YoutubeService {
    extractor: Arc<dyn YoutubeExtractor>,
}

impl YoutubeService {
    #[must_use]
    pub fn new(extractor: Arc<dyn YoutubeExtractor>) -> Self {
        Self { extractor }
    }

    pub async fn search_videos(
        &self,
        request: SearchVideosRequest,
    ) -> AppResult<SearchVideosResponse> {
        self.extractor.search_videos(request).await
    }

    pub async fn get_video_details(&self, video_id: &str) -> AppResult<VideoDetails> {
        self.extractor.get_video_details(video_id).await
    }

    pub async fn get_related_videos(&self, video_id: &str) -> AppResult<Vec<RelatedContentItem>> {
        self.extractor.get_related_videos(video_id).await
    }

    pub async fn get_stream_info(&self, video_id: &str, refresh: bool) -> AppResult<StreamInfo> {
        self.extractor.get_stream_info(video_id, refresh).await
    }

    pub async fn get_channel_details(&self, channel_id: &str) -> AppResult<ChannelDetails> {
        self.extractor.get_channel_details(channel_id).await
    }

    pub async fn get_channel_tab(
        &self,
        channel_id: &str,
        params: Option<String>,
        page_token: Option<String>,
        query: Option<String>,
    ) -> AppResult<ChannelTabResponse> {
        self.extractor
            .get_channel_tab(channel_id, params, page_token, query)
            .await
    }

    pub async fn get_playlist_details(
        &self,
        playlist_id: &str,
        page_token: Option<String>,
    ) -> AppResult<PlaylistDetailsResponse> {
        self.extractor
            .get_playlist_details(playlist_id, page_token)
            .await
    }

    pub async fn get_comments(
        &self,
        video_id: &str,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        self.extractor.get_comments(video_id, page_token).await
    }

    pub async fn get_post_comments(
        &self,
        post_id: &str,
        params: Option<String>,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        self.extractor
            .get_post_comments(post_id, params, page_token)
            .await
    }

    pub async fn get_live_chat(
        &self,
        video_id: &str,
        continuation: Option<String>,
    ) -> AppResult<LiveChatResponse> {
        self.extractor.get_live_chat(video_id, continuation).await
    }

    pub async fn get_trending_videos(
        &self,
        category: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<Vec<VideoSummary>> {
        self.extractor.get_trending_videos(category, region).await
    }

    pub async fn get_search_suggestions(&self, query: &str) -> AppResult<Vec<String>> {
        self.extractor.get_search_suggestions(query).await
    }

    pub async fn get_shorts_sequence(
        &self,
        params: Option<String>,
        sequence_params: Option<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        self.extractor
            .get_shorts_sequence(params, sequence_params, region)
            .await
    }

    pub async fn search_music(&self, query: &str, filter: &str) -> AppResult<Vec<VideoSummary>> {
        self.extractor.search_music(query, filter).await
    }

    pub fn parse_subscription_export(&self, data: &str) -> AppResult<Vec<(String, String)>> {
        self.extractor.parse_subscription_export(data)
    }

    pub async fn get_music_lyrics(&self, video_id: &str) -> AppResult<Option<String>> {
        self.extractor.get_music_lyrics(video_id).await
    }

    pub async fn get_music_related(&self, video_id: &str) -> AppResult<Vec<VideoSummary>> {
        self.extractor.get_music_related(video_id).await
    }

    pub async fn get_music_album(&self, album_browse_id: &str) -> AppResult<Vec<VideoSummary>> {
        self.extractor.get_music_album(album_browse_id).await
    }

    pub async fn get_music_home(&self) -> AppResult<(Vec<MusicHomeSection>, Vec<MusicHomeChip>)> {
        self.extractor.get_music_home().await
    }

    pub async fn get_music_artist(&self, artist_browse_id: &str) -> AppResult<ArtistPage> {
        self.extractor.get_music_artist(artist_browse_id).await
    }

    pub async fn get_music_explore(&self) -> AppResult<ExplorePage> {
        self.extractor.get_music_explore().await
    }

    pub async fn get_music_charts(&self, continuation: Option<String>) -> AppResult<ChartsPage> {
        self.extractor.get_music_charts(continuation).await
    }
}
