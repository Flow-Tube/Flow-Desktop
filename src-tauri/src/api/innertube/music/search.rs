//! Search extractors: filtered search (+continuation), no-filter "summary"
//! (top-result card), and rich search suggestions.

use serde_json::{Value, json};

use super::clients;
use super::endpoints;
use super::parse::items;
use super::parse::runs::runs_text;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::http::custom_url_encode;
use crate::errors::AppResult;
use crate::models::music_pages::{
    MusicSearchResponse, MusicSearchSection, MusicSearchSuggestions, SearchSummaryPage,
};

impl InnertubeClient {
    /// Filtered search. `filter` ∈ songs/videos/albums/artists/playlists/
    /// community_playlists/featured_playlists/podcasts/episodes (or empty).
    pub(crate) async fn music_search(
        &self,
        query: &str,
        filter: &str,
    ) -> AppResult<MusicSearchResponse> {
        let mut payload = json!({ "query": query });
        if let Some(p) = endpoints::search_filter_params(filter) {
            payload["params"] = json!(p);
        }
        let res = self
            .post_music("search", &clients::WEB_REMIX, &mut payload, None)
            .await?;
        let (sections, continuation) = parse_search_sections(&res);
        Ok(MusicSearchResponse {
            sections,
            continuation,
            filters: offered_filters(&res),
        })
    }

    /// Continue a filtered search.
    pub(crate) async fn music_search_continuation(
        &self,
        token: &str,
    ) -> AppResult<MusicSearchResponse> {
        let enc = custom_url_encode(token);
        let extra = format!("&ctoken={enc}&continuation={enc}&type=next");
        let mut payload = json!({});
        let res = self
            .post_music("search", &clients::WEB_REMIX, &mut payload, Some(&extra))
            .await?;
        let shelf = &res["continuationContents"]["musicShelfContinuation"];
        let items = shelves::collect_items(&shelf["contents"]);
        let next = continuation::any(shelf, &shelf["contents"]);
        Ok(MusicSearchResponse {
            sections: vec![MusicSearchSection {
                title: String::new(),
                items,
                is_top_result: false,
            }],
            continuation: next,
            filters: Vec::new(),
        })
    }

    /// No-filter "summary" search — top-result card + per-category previews.
    pub(crate) async fn music_search_summary(&self, query: &str) -> AppResult<SearchSummaryPage> {
        let mut payload = json!({ "query": query });
        let res = self
            .post_music("search", &clients::WEB_REMIX, &mut payload, None)
            .await?;
        Ok(parse_summary(&res))
    }

    /// Rich search suggestions (text completions + tappable entities).
    pub(crate) async fn music_search_suggestions(
        &self,
        query: &str,
    ) -> AppResult<MusicSearchSuggestions> {
        let mut payload = json!({ "input": query });
        let res = self
            .post_music(
                "music/get_search_suggestions",
                &clients::WEB_REMIX,
                &mut payload,
                None,
            )
            .await?;

        let mut queries = Vec::new();
        let mut recommended_items = Vec::new();
        if let Some(contents) = res["contents"].as_array() {
            for section in contents {
                let Some(list) = section["searchSuggestionsSectionRenderer"]["contents"].as_array()
                else {
                    continue;
                };
                for entry in list {
                    if let Some(text) = runs_text(&entry["searchSuggestionRenderer"]["suggestion"])
                    {
                        queries.push(text);
                    } else if let Some(item) =
                        items::parse_responsive_list_item(&entry["musicResponsiveListItemRenderer"])
                    {
                        recommended_items.push(item);
                    }
                }
            }
        }

        Ok(MusicSearchSuggestions {
            queries,
            recommended_items,
        })
    }
}

/// A no-filter search answer: its sections, the top result first, and the
/// filters offered for the query.
#[must_use]
pub fn parse_summary(res: &Value) -> SearchSummaryPage {
    SearchSummaryPage {
        summaries: parse_search_sections(res).0,
        filters: offered_filters(res),
    }
}

fn section_list(res: &Value) -> &Value {
    &res["contents"]["tabbedSearchResultsRenderer"]["tabs"][0]["tabRenderer"]["content"]["sectionListRenderer"]
}

/// The filters the chip bar offers, in its order: the site names only the
/// categories this query has results in.
fn offered_filters(res: &Value) -> Vec<String> {
    section_list(res)["header"]["chipCloudRenderer"]["chips"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|chip| {
            chip["chipCloudChipRenderer"]["navigationEndpoint"]["searchEndpoint"]["params"].as_str()
        })
        .filter_map(endpoints::search_filter_of_params)
        .map(ToOwned::to_owned)
        .collect()
}

/// Parse a tabbed search response into sections + a continuation token. The
/// top-result card comes first with the rows it holds (top songs, or songs
/// related to it), which the site does not repeat elsewhere.
fn parse_search_sections(res: &Value) -> (Vec<MusicSearchSection>, Option<String>) {
    let mut sections = Vec::new();
    let mut cont = None;

    let Some(arr) = section_list(res)["contents"].as_array() else {
        return (sections, cont);
    };

    for section in arr {
        if let Some(card) = section.get("musicCardShelfRenderer") {
            let mut items: Vec<_> = items::parse_card_shelf(card).into_iter().collect();
            items.extend(
                card["contents"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|row| {
                        items::parse_responsive_list_item(&row["musicResponsiveListItemRenderer"])
                    }),
            );
            if !items.is_empty() {
                sections.insert(
                    0,
                    MusicSearchSection {
                        title: runs_text(
                            &card["header"]["musicCardShelfHeaderBasicRenderer"]["title"],
                        )
                        .unwrap_or_default(),
                        items,
                        is_top_result: true,
                    },
                );
            }
        } else if let Some(shelf) = section.get("musicShelfRenderer") {
            let title = runs_text(&shelf["title"]).unwrap_or_default();
            let items = shelves::collect_items(&shelf["contents"]);
            if cont.is_none() {
                cont = continuation::any(shelf, &shelf["contents"]);
            }
            if !items.is_empty() {
                sections.push(MusicSearchSection {
                    title,
                    items,
                    is_top_result: false,
                });
            }
        } else if let Some(isr) = section.get("itemSectionRenderer") {
            let items = shelves::collect_items(&isr["contents"]);
            if !items.is_empty() {
                sections.push(MusicSearchSection {
                    title: runs_text(&isr["header"]["itemSectionTabbedHeaderRenderer"]["title"])
                        .unwrap_or_default(),
                    items,
                    is_top_result: false,
                });
            }
        }
    }

    (sections, cont)
}
