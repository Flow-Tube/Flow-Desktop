//! Subscriptions' Posts view: community posts of the followed channels, a page of channels at a time.

use tauri::State;

use crate::errors::ErrorResponse;
use crate::security::validation::validate_channel_id;
use crate::services::subscription_feed::posts::{self, PostsChannel, SubscriptionPostsPage};
use crate::services::youtube_service::YoutubeService;

/// Page `page` of `channels`' recent posts, the channels ranked by `recent_uploader_ids` (channel
/// ids newest upload first). A channel id that is not valid is skipped rather than failing the page.
#[tauri::command]
pub async fn get_subscription_posts(
    channels: Vec<PostsChannel>,
    recent_uploader_ids: Vec<String>,
    page: usize,
    youtube_service: State<'_, YoutubeService>,
) -> Result<SubscriptionPostsPage, ErrorResponse> {
    let channels: Vec<PostsChannel> = channels
        .into_iter()
        .filter_map(|mut channel| {
            channel.id = channel.id.trim().trim_start_matches("channel:").to_string();
            validate_channel_id(&channel.id).ok().map(|()| channel)
        })
        .collect();
    let now_ms = u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0);
    let youtube_service = youtube_service.inner();
    posts::load_page(
        channels,
        &recent_uploader_ids,
        page,
        posts::posts_cache(),
        now_ms,
        |channel| posts::channel_posts(youtube_service, channel.id),
    )
    .await
    .map_err(ErrorResponse::from)
}

/// Drops every channel's cached posts, so a refresh reads each channel again.
#[tauri::command]
pub fn forget_subscription_posts() {
    posts::posts_cache().clear();
}
