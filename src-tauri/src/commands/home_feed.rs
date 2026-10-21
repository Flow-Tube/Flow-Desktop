//! The Home feed: the page asks for a snapshot and reports what is in view; every later change
//! arrives as the `home-feed` event.

use tauri::{AppHandle, State};

use crate::flow_neuro::interest_chips::InterestChip;
use crate::services::home_feed::chips::ChipFeed;
use crate::services::home_feed::{HomeFeedService, HomeSnapshot};

#[tauri::command]
pub async fn home_feed_open(
    app: AppHandle,
    home: State<'_, HomeFeedService>,
) -> Result<HomeSnapshot, ()> {
    Ok(home.open(&app).await)
}

#[tauri::command]
pub fn home_feed_refresh(app: AppHandle, home: State<'_, HomeFeedService>) -> HomeSnapshot {
    home.refresh(&app)
}

#[tauri::command]
pub fn home_feed_viewport(app: AppHandle, last_visible: usize, home: State<'_, HomeFeedService>) {
    home.viewport(&app, last_visible);
}

#[tauri::command]
pub fn home_feed_visible(app: AppHandle, visible: bool, home: State<'_, HomeFeedService>) {
    home.set_visible(&app, visible);
}

#[tauri::command]
pub fn home_feed_retry_more(app: AppHandle, home: State<'_, HomeFeedService>) {
    home.retry_more(&app);
}

#[tauri::command]
pub async fn home_feed_clear(app: AppHandle, home: State<'_, HomeFeedService>) -> Result<(), ()> {
    home.clear(&app).await;
    Ok(())
}

/// The interest chips beside "All", "New to you" and "Recently uploaded".
#[tauri::command]
pub async fn home_feed_chips(
    app: AppHandle,
    home: State<'_, HomeFeedService>,
) -> Result<Vec<InterestChip>, ()> {
    Ok(home.interest_chips(&app).await)
}

/// One chip's videos; `refresh` fetches them again.
#[tauri::command]
pub async fn home_chip_feed(
    app: AppHandle,
    key: String,
    refresh: bool,
    home: State<'_, HomeFeedService>,
) -> Result<ChipFeed, ()> {
    Ok(home.chip_feed(&app, &key, refresh).await)
}
