//! A channel: its header, tabs, each tab's items and filters, and its About
//! panel. Ported from Flow for Android's channel parsers, read structurally so
//! no tab, shelf or filter depends on its English title.

mod about;
mod filters;
mod header;
mod items;
mod posts;
mod tabs;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::sync::Semaphore;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::continuation::continuation_item_lists;
use crate::errors::{AppError, AppResult};
use crate::models::channel::{ChannelAbout, ChannelDetails, ChannelPage, ChannelTabResponse};

pub use about::parse_about;
pub use header::parse_header;

/// The params of a channel's search tab.
const SEARCH_PARAMS: &str = "EgZzZWFyY2jyBgQKAloA";
const DETAILS_TTL: Duration = Duration::from_mins(30);
const DETAILS_CAPACITY: usize = 512;
/// Avatar lookups browse a whole landing page each; a feed must not open dozens at once.
const DETAILS_CONCURRENCY: usize = 4;

fn details_cache() -> &'static Mutex<HashMap<String, (Instant, ChannelDetails)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, ChannelDetails)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_details(requested: &str, details: &ChannelDetails) {
    let mut cache = details_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if cache.len() >= DETAILS_CAPACITY {
        cache.clear();
    }
    cache.insert(requested.to_string(), (Instant::now(), details.clone()));
}

/// A tab page: the selected tab's grid or Home shelves, its filters, and any
/// continuation items the response appended.
#[must_use]
pub fn parse_tab(page: &Value, channel_id: &str) -> ChannelTabResponse {
    let header = parse_header(page, channel_id);
    let owner = items::Owner {
        id: Some(header.id.clone()),
        name: header.name,
    };
    let mut response = ChannelTabResponse {
        channel_id: owner.id.clone().unwrap_or_default(),
        ..ChannelTabResponse::default()
    };
    let content = tabs::selected_content(page);
    if let Some(content) = content {
        if let Some(grid) = content["richGridRenderer"]["contents"].as_array() {
            items::collect(
                grid,
                &owner,
                &mut response.items,
                &mut response.next_page_token,
            );
        } else if let Some(list) = content["sectionListRenderer"]["contents"].as_array() {
            response.sections = items::sections(list, &owner);
            if response.sections.is_empty() {
                items::collect(
                    list,
                    &owner,
                    &mut response.items,
                    &mut response.next_page_token,
                );
            } else {
                response.items = response
                    .sections
                    .iter()
                    .flat_map(|section| section.items.clone())
                    .collect();
            }
        }
    }
    for list in continuation_item_lists(page) {
        items::collect(
            list,
            &owner,
            &mut response.items,
            &mut response.next_page_token,
        );
    }
    response.filters = filters::filters(content.unwrap_or(page));
    if response.filters.is_empty() && content.is_some() {
        response.filters = filters::filters(page);
    }
    response
}

impl InnertubeClient {
    async fn channel_browse(&self, mut body: Value) -> AppResult<Value> {
        self.post_innertube("browse", &clients::WEB, &mut body)
            .await
    }

    /// A channel's landing page: header, tabs and Home from one request.
    pub async fn get_channel_page(&self, channel_id: &str) -> AppResult<ChannelPage> {
        let channel_id = valid_id(channel_id)?;
        let page = self
            .channel_browse(json!({ "browseId": channel_id }))
            .await?;
        let details = parse_header(&page, channel_id);
        remember_details(channel_id, &details);
        Ok(ChannelPage {
            home: parse_tab(&page, channel_id),
            details,
        })
    }

    /// Just the header (name, avatar, counts, tabs), cached for half an hour
    /// and fetched at most four at a time: avatar lookups ask for many channels.
    pub async fn get_channel_details(&self, channel_id: &str) -> AppResult<ChannelDetails> {
        static PERMITS: OnceLock<Semaphore> = OnceLock::new();
        let channel_id = valid_id(channel_id)?;
        let cached = || {
            details_cache()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(channel_id)
                .filter(|(at, _)| at.elapsed() < DETAILS_TTL)
                .map(|(_, details)| details.clone())
        };
        if let Some(details) = cached() {
            return Ok(details);
        }
        let _permit = PERMITS
            .get_or_init(|| Semaphore::new(DETAILS_CONCURRENCY))
            .acquire()
            .await
            .map_err(|_| AppError::Internal("channel lookups closed".into()))?;
        // Another lookup may have fetched it while this one waited.
        if let Some(details) = cached() {
            return Ok(details);
        }
        let page = self
            .channel_browse(json!({ "browseId": channel_id }))
            .await?;
        let details = parse_header(&page, channel_id);
        remember_details(channel_id, &details);
        Ok(details)
    }

    /// A tab by the params the channel's page named, a page of it by token, or
    /// a search of the channel.
    pub async fn get_channel_tab(
        &self,
        channel_id: &str,
        params: Option<String>,
        page_token: Option<String>,
        query: Option<String>,
    ) -> AppResult<ChannelTabResponse> {
        let channel_id = valid_id(channel_id)?;
        let body = if let Some(token) = page_token {
            json!({ "continuation": token })
        } else if let Some(query) = query {
            json!({ "browseId": channel_id, "params": SEARCH_PARAMS, "query": query })
        } else if let Some(params) = params {
            json!({ "browseId": channel_id, "params": params })
        } else {
            json!({ "browseId": channel_id })
        };
        let page = self.channel_browse(body).await?;
        Ok(parse_tab(&page, channel_id))
    }

    /// The About panel behind [`ChannelDetails::about_token`].
    pub async fn get_channel_about(&self, token: &str) -> AppResult<ChannelAbout> {
        let page = self
            .channel_browse(json!({ "continuation": token }))
            .await?;
        parse_about(&page)
            .ok_or_else(|| AppError::ContentNotAvailable("This channel has no About panel".into()))
    }
}

fn valid_id(channel_id: &str) -> AppResult<&str> {
    let channel_id = channel_id.trim();
    if channel_id.is_empty() {
        return Err(AppError::Validation("Channel ID cannot be empty".into()));
    }
    Ok(channel_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::channel::ChannelItem;

    #[test]
    fn later_search_pages_unwrap_each_item_section() {
        let page = json!({ "onResponseReceivedActions": [{ "appendContinuationItemsAction": {
            "continuationItems": [
                { "itemSectionRenderer": { "contents": [{ "videoRenderer": {
                    "videoId": "vid00000031",
                    "title": { "runs": [{ "text": "Page two" }] }
                } }] } },
                { "continuationItemRenderer": { "continuationEndpoint": {
                    "continuationCommand": { "token": "PAGE3" } } } }
            ]
        } }] });
        let tab = parse_tab(&page, "UCx");
        assert!(
            matches!(tab.items.as_slice(), [ChannelItem::Video(video)] if video.id == "vid00000031")
        );
        assert_eq!(tab.next_page_token.as_deref(), Some("PAGE3"));
    }
}
