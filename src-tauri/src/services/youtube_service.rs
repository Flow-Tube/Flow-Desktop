use std::sync::Arc;

use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::channel::{ChannelAbout, ChannelDetails, ChannelPage, ChannelTabResponse};
use crate::models::comment::CommentsResponse;
use crate::models::explore::{ExploreGrid, ExplorePage, ExploreTarget};
use crate::models::live_chat::LiveChatResponse;
use crate::models::playlist::PlaylistDetailsResponse;
use crate::models::search::{SearchVideosRequest, SearchVideosResponse};
use crate::models::shorts::{ShortItem, ShortsFeed};
use crate::models::video::{RelatedPage, StreamInfo, VideoBasics, VideoDetails};

#[derive(Clone)]
pub struct YoutubeService {
    extractor: Arc<InnertubeClient>,
}

impl YoutubeService {
    #[must_use]
    pub fn new(extractor: Arc<InnertubeClient>) -> Self {
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

    pub async fn get_video_basics(&self, video_id: &str) -> AppResult<VideoBasics> {
        self.extractor.get_video_basics(video_id).await
    }

    pub async fn get_related_videos(&self, video_id: &str) -> AppResult<RelatedPage> {
        self.extractor.get_related_videos(video_id).await
    }

    pub async fn get_video_category(&self, video_id: &str) -> AppResult<Option<String>> {
        self.extractor.get_video_category(video_id).await
    }

    pub async fn get_feed_related_videos(&self, video_id: &str) -> AppResult<RelatedPage> {
        self.extractor.get_feed_related_videos(video_id).await
    }

    pub async fn get_more_related_videos(&self, continuation: &str) -> AppResult<RelatedPage> {
        self.extractor.get_more_related_videos(continuation).await
    }

    pub async fn get_stream_info(&self, video_id: &str, refresh: bool) -> AppResult<StreamInfo> {
        self.extractor.get_stream_info(video_id, refresh).await
    }

    pub async fn get_channel_page(&self, channel_id: &str) -> AppResult<ChannelPage> {
        self.extractor.get_channel_page(channel_id).await
    }

    pub async fn get_channel_about(&self, token: &str) -> AppResult<ChannelAbout> {
        self.extractor.get_channel_about(token).await
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
        replay_offset_ms: Option<u64>,
    ) -> AppResult<LiveChatResponse> {
        self.extractor
            .get_live_chat(video_id, continuation, replay_offset_ms)
            .await
    }

    pub async fn get_explore_destination(
        &self,
        destination: &str,
        region: Option<&str>,
    ) -> AppResult<ExplorePage> {
        self.extractor
            .get_explore_destination(destination, region)
            .await
    }

    pub async fn get_explore_page(
        &self,
        browse_id: &str,
        params: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<ExplorePage> {
        self.extractor
            .get_explore_page(browse_id, params, region)
            .await
    }

    pub async fn get_explore_grid(
        &self,
        target: Option<&ExploreTarget>,
        continuation: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<ExploreGrid> {
        self.extractor
            .get_explore_grid(target, continuation, region)
            .await
    }

    /// Title, channel and counts for the first reels in `items` that came without them.
    pub async fn fill_short_details(&self, items: &mut [ShortItem]) {
        self.extractor.fill_reel_overlays(items).await;
    }

    pub async fn get_search_suggestions(
        &self,
        query: &str,
        region: Option<&str>,
    ) -> AppResult<Vec<String>> {
        self.extractor.get_search_suggestions(query, region).await
    }

    pub async fn get_shorts_sequence(
        &self,
        sequence_params: Option<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        self.extractor
            .get_shorts_sequence(sequence_params, region)
            .await
    }

    pub fn parse_subscription_export(&self, data: &str) -> AppResult<Vec<(String, String)>> {
        self.extractor.parse_subscription_export(data)
    }
}
