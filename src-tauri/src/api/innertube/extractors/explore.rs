//! Explore, rebuilt on the destinations that still answer anonymously (Flow for
//! Android's `ExploreDestination`). `FEtrending` and `FEexplore` answer 400 on
//! every client since 2026-09-18, and charts.youtube.com 429 since 2026-10-08,
//! so there is no anonymous "Trending" or "Movies" left. Only the browse ids live
//! here: every shelf and tab token is read back out of the page that carries it,
//! so a token rotation cannot strand a destination.

use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::continuation::{continuation_item_lists, last_continuation_token};
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::renderers::lockup::{lockup_item, related_to_video};
use crate::api::innertube::renderers::video::video_from_item;
use crate::errors::{AppError, AppResult};
use crate::models::explore::{ExploreGrid, ExplorePage, ExploreShelf, ExploreTab, ExploreTarget};
use crate::models::music::YTItem;
use crate::models::video::VideoSummary;

const TRENDING_PLAYLIST_PREFIX: &str = "OLAK5uy_";

/// A destination's browse id, and the params of the one page that is not
/// reachable from a response: Gaming lands on a game carousel, so its Trending
/// tab is asked for directly.
fn destination(id: &str) -> Option<(&'static str, Option<&'static str>)> {
    Some(match id {
        "live" => ("UC4R8DWoMoI7CAwX8_LjQHig", None),
        "gaming" => ("UCOpNcN46UbXVtpKMrmU4Abg", Some("Egh0cmVuZGluZw%3D%3D")),
        "news" => ("FEnews_destination", None),
        "sports" => ("UCEgdi0XIXXZ-qJOFPf4JSKw", None),
        "learning" => ("UCtFRv9O2AHqOZjjynzrv-xg", None),
        "fashion" => ("UCrpQ4p1Ql_hG8rKXIKM1MOQ", None),
        _ => return None,
    })
}

fn sanitize_region(region: Option<&str>) -> String {
    let cleaned = region.unwrap_or("US").trim().to_ascii_uppercase();
    if cleaned.len() == 2 && cleaned.chars().all(|c| c.is_ascii_alphabetic()) {
        cleaned
    } else {
        "US".to_string()
    }
}

fn target_of(endpoint: &Value) -> Option<ExploreTarget> {
    let browse = &endpoint["browseEndpoint"];
    Some(ExploreTarget {
        browse_id: browse["browseId"].as_str()?.to_string(),
        params: browse["params"].as_str().map(ToOwned::to_owned),
    })
}

fn tab_renderers(page: &Value) -> Vec<&Value> {
    page["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tab| {
            tab.get("tabRenderer")
                .or_else(|| tab.get("expandableTabRenderer"))
        })
        .collect()
}

/// The selected tab's content, falling back to the first that has any: News
/// marks a tab selected, Live does not.
fn selected_container(page: &Value) -> Option<&Value> {
    let tabs = tab_renderers(page);
    let tab = tabs
        .iter()
        .find(|tab| tab["selected"].as_bool() == Some(true) && tab.get("content").is_some())
        .or_else(|| tabs.iter().find(|tab| tab.get("content").is_some()))?;
    let content = &tab["content"];
    content
        .get("richGridRenderer")
        .or_else(|| content.get("sectionListRenderer"))
}

fn video_of(item: &Value) -> Option<VideoSummary> {
    video_from_item(item).or_else(|| {
        let lockup = item
            .get("richItemRenderer")
            .map_or(item, |rich| &rich["content"])
            .get("lockupViewModel")?;
        lockup_item(lockup)
            .filter(|lockup| lockup.item_type == "video")
            .map(related_to_video)
    })
}

/// A shelf as a rich grid (`richShelfRenderer`) or a section list
/// (`shelfRenderer` around a grid or list) holds it.
fn shelf_of(shelf: &Value) -> Option<ExploreShelf> {
    let content = &shelf["content"];
    let items = shelf["contents"]
        .as_array()
        .or_else(|| content["gridRenderer"]["items"].as_array())
        .or_else(|| content["horizontalListRenderer"]["items"].as_array())
        .or_else(|| content["verticalListRenderer"]["items"].as_array())
        .or_else(|| content["expandedShelfContentsRenderer"]["items"].as_array())?;
    let videos: Vec<VideoSummary> = items.iter().filter_map(video_of).collect();
    if videos.is_empty() {
        return None;
    }
    Some(ExploreShelf {
        title: text_of(&shelf["title"]).unwrap_or_default(),
        videos,
        more: target_of(&shelf["endpoint"]),
    })
}

fn collect_shelves(
    items: &[Value],
    shelves: &mut Vec<ExploreShelf>,
    loose: &mut Vec<VideoSummary>,
) {
    for item in items {
        if let Some(inner) = item["itemSectionRenderer"]["contents"].as_array() {
            collect_shelves(inner, shelves, loose);
        } else if let Some(shelf) = item["richSectionRenderer"]["content"]
            .get("richShelfRenderer")
            .or_else(|| item.get("shelfRenderer"))
        {
            shelves.extend(shelf_of(shelf));
        } else if let Some(video) = video_of(item) {
            loose.push(video);
        }
    }
}

/// A destination landing page or one of its tabs.
#[must_use]
pub fn parse_explore_page(page: &Value) -> ExplorePage {
    let mut shelves = Vec::new();
    let mut loose = Vec::new();
    if let Some(items) =
        selected_container(page).and_then(|container| container["contents"].as_array())
    {
        collect_shelves(items, &mut shelves, &mut loose);
    }
    // Videos laid straight into the grid read as one shelf under the page's title.
    let title = page["header"]["pageHeaderRenderer"]["pageTitle"]
        .as_str()
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);
    if !loose.is_empty() {
        shelves.insert(
            0,
            ExploreShelf {
                title: title.clone().unwrap_or_default(),
                videos: loose,
                more: None,
            },
        );
    }
    let tabs = tab_renderers(page)
        .into_iter()
        .filter_map(|tab| {
            Some(ExploreTab {
                title: text_of(&tab["title"])?.trim().to_string(),
                target: target_of(&tab["endpoint"])?,
                selected: tab["selected"].as_bool().unwrap_or(false),
            })
        })
        .filter(|tab| !tab.title.is_empty())
        .collect();
    ExplorePage {
        title,
        tabs,
        shelves,
    }
}

/// A page of a shelf's full grid: the first, or a continuation.
#[must_use]
pub fn parse_explore_grid(page: &Value) -> ExploreGrid {
    let first: Vec<&Vec<Value>> = selected_container(page)
        .and_then(|container| container["contents"].as_array())
        .into_iter()
        .collect();
    let lists: Vec<&Vec<Value>> = first
        .into_iter()
        .chain(continuation_item_lists(page))
        .collect();
    let mut shelves = Vec::new();
    let mut videos = Vec::new();
    for list in &lists {
        collect_shelves(list, &mut shelves, &mut videos);
    }
    videos.extend(shelves.into_iter().flat_map(|shelf| shelf.videos));
    let mut seen = std::collections::HashSet::new();
    videos.retain(|video| seen.insert(video.id.clone()));
    ExploreGrid {
        videos,
        continuation: lists.last().and_then(|list| last_continuation_token(list)),
    }
}

impl InnertubeClient {
    /// A browse request in `region`, under the visitor identity every other
    /// request carries: a see-all grid's continuation is refused without it.
    async fn explore_browse(&self, mut body: Value, region: Option<&str>) -> AppResult<Value> {
        let visitor = self.fetch_visitor_data().await;
        body["context"] = clients::WEB.context(visitor.as_deref(), Some(&sanitize_region(region)));
        self.post_innertube("browse", &clients::WEB, &mut body)
            .await
    }

    /// One of Explore's destinations: `live`, `gaming`, `news`, `sports`,
    /// `learning`, `fashion`, or `music` (the region's trending music video chart).
    pub async fn get_explore_destination(
        &self,
        id: &str,
        region: Option<&str>,
    ) -> AppResult<ExplorePage> {
        if id == "music" {
            return self.music_video_chart(region).await;
        }
        let (browse_id, params) = destination(id)
            .ok_or_else(|| AppError::Validation(format!("Unknown Explore destination {id}")))?;
        self.get_explore_page(browse_id, params, region).await
    }

    /// A destination page or one of its tabs, by the target a response named.
    pub async fn get_explore_page(
        &self,
        browse_id: &str,
        params: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<ExplorePage> {
        let mut body = json!({ "browseId": browse_id });
        if let Some(params) = params {
            body["params"] = json!(params);
        }
        Ok(parse_explore_page(
            &self.explore_browse(body, region).await?,
        ))
    }

    /// A shelf's full grid, page by page.
    pub async fn get_explore_grid(
        &self,
        target: Option<&ExploreTarget>,
        continuation: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<ExploreGrid> {
        let body = match (continuation, target) {
            (Some(token), _) => json!({ "continuation": token }),
            (None, Some(target)) => {
                let mut body = json!({ "browseId": target.browse_id });
                if let Some(params) = &target.params {
                    body["params"] = json!(params);
                }
                body
            }
            (None, None) => {
                return Err(AppError::Validation(
                    "An Explore grid needs a target or a token".into(),
                ));
            }
        };
        Ok(parse_explore_grid(
            &self.explore_browse(body, region).await?,
        ))
    }

    /// The region's trending music videos, ranked, from the music service's
    /// charts: the auto-generated trending playlist when the region has one,
    /// else its first video chart.
    async fn music_video_chart(&self, region: Option<&str>) -> AppResult<ExplorePage> {
        let region = sanitize_region(region);
        let charts = self.music_charts_page(None, Some(&region)).await?;
        let playlists: Vec<_> = charts
            .sections
            .iter()
            .filter(|section| section.chart_type == "Playlists")
            .flat_map(|section| &section.items)
            .filter_map(|item| match item {
                YTItem::Playlist(playlist) => Some(playlist),
                _ => None,
            })
            .collect();
        let chart = playlists
            .iter()
            .find(|playlist| {
                playlist
                    .id
                    .trim_start_matches("VL")
                    .starts_with(TRENDING_PLAYLIST_PREFIX)
            })
            .or_else(|| playlists.first())
            .ok_or_else(|| {
                AppError::ContentNotAvailable("No music chart for this region".into())
            })?;
        let playlist = self
            .get_playlist_details(chart.id.trim_start_matches("VL"), None)
            .await?;
        let mut videos = playlist.videos;
        for (index, video) in videos.iter_mut().enumerate() {
            video.badges.insert(0, format!("#{}", index + 1));
        }
        Ok(ExplorePage {
            title: Some(chart.title.clone()),
            tabs: Vec::new(),
            shelves: vec![ExploreShelf {
                title: chart.title.clone(),
                videos,
                more: None,
            }],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: &str) -> Value {
        json!({ "richItemRenderer": { "content": { "videoRenderer": {
            "videoId": id, "title": { "runs": [{ "text": id }] }
        } } } })
    }

    #[test]
    fn a_rich_grid_page_reads_its_shelves_and_tabs() {
        let page = json!({
            "header": { "pageHeaderRenderer": { "pageTitle": "News" } },
            "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [
                { "tabRenderer": { "title": "Top stories", "selected": true,
                    "endpoint": { "browseEndpoint": { "browseId": "FEnews_destination", "params": "TOP" } },
                    "content": { "richGridRenderer": { "contents": [
                        { "richSectionRenderer": { "content": { "carouselItemRenderer": {} } } },
                        { "richSectionRenderer": { "content": { "richShelfRenderer": {
                            "title": { "runs": [{ "text": "Live Now" }] },
                            "contents": [video("aaaaaaaaaaa"), video("bbbbbbbbbbb")],
                            "endpoint": { "browseEndpoint": { "browseId": "UC4R8DWoMoI7CAwX8_LjQHig", "params": "MORE" } }
                        } } } }
                    ] } } } },
                { "tabRenderer": { "title": "Sports",
                    "endpoint": { "browseEndpoint": { "browseId": "FEnews_destination", "params": "SPORTS" } } } }
            ] } }
        });
        let parsed = parse_explore_page(&page);
        assert_eq!(parsed.title.as_deref(), Some("News"));
        assert_eq!(parsed.shelves.len(), 1);
        assert_eq!(parsed.shelves[0].title, "Live Now");
        assert_eq!(parsed.shelves[0].videos.len(), 2);
        assert_eq!(
            parsed.shelves[0]
                .more
                .as_ref()
                .and_then(|more| more.params.as_deref()),
            Some("MORE")
        );
        assert_eq!(parsed.tabs.len(), 2);
        assert!(parsed.tabs[0].selected);
        assert_eq!(parsed.tabs[1].target.params.as_deref(), Some("SPORTS"));
    }

    #[test]
    fn a_section_list_grid_reads_as_a_shelf() {
        let page = json!({ "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [
            { "tabRenderer": { "content": { "sectionListRenderer": { "contents": [
                { "itemSectionRenderer": { "contents": [{ "shelfRenderer": {
                    "title": { "runs": [{ "text": "Trending videos" }] },
                    "content": { "gridRenderer": { "items": [
                        { "gridVideoRenderer": { "videoId": "ccccccccccc", "title": { "runs": [{ "text": "C" }] } } }
                    ] } }
                } }] } }
            ] } } } }
        ] } } });
        let parsed = parse_explore_page(&page);
        assert_eq!(parsed.shelves[0].title, "Trending videos");
        assert_eq!(parsed.shelves[0].videos[0].id, "ccccccccccc");
    }

    #[test]
    fn a_see_all_grid_pages_on() {
        let first = json!({ "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [
            { "tabRenderer": { "content": { "richGridRenderer": { "contents": [
                video("ddddddddddd"),
                { "continuationItemRenderer": { "continuationEndpoint": { "continuationCommand": { "token": "PAGE2" } } } }
            ] } } } }
        ] } } });
        let grid = parse_explore_grid(&first);
        assert_eq!(grid.videos.len(), 1);
        assert_eq!(grid.continuation.as_deref(), Some("PAGE2"));

        let next = json!({ "onResponseReceivedActions": [{ "appendContinuationItemsAction": {
            "continuationItems": [video("eeeeeeeeeee")]
        } }] });
        let grid = parse_explore_grid(&next);
        assert_eq!(grid.videos[0].id, "eeeeeeeeeee");
        assert_eq!(grid.continuation, None);
    }
}
