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
use crate::models::music::{Artist, YTItem};
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
            let card_artist = match items.first() {
                Some(YTItem::Artist(artist)) => Some(Artist {
                    name: artist.title.clone(),
                    id: Some(artist.id.clone()),
                }),
                _ => None,
            };
            items.extend(
                card["contents"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|row| {
                        items::parse_responsive_list_item(&row["musicResponsiveListItemRenderer"])
                    })
                    .map(|item| credited_to_card(item, card_artist.as_ref())),
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

/// A song under an artist's top result card names no artist: its byline is only its type and
/// length, which the row parser reads as an unlinked artist. It is that artist's song.
fn credited_to_card(item: YTItem, card_artist: Option<&Artist>) -> YTItem {
    match (item, card_artist) {
        (YTItem::Song(mut song), Some(artist))
            if song.artists.iter().all(|credited| credited.id.is_none()) =>
        {
            song.artists = vec![artist.clone()];
            YTItem::Song(song)
        }
        (item, _) => item,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACDC: &str = "UCVm4YdI3hobkwsHTTOMVJKg";

    fn browse(id: &str, page_type: &str) -> Value {
        json!({ "browseEndpoint": { "browseId": id, "browseEndpointContextSupportedConfigs": {
            "browseEndpointContextMusicConfig": { "pageType": page_type } } } })
    }

    fn song_row(video_id: &str, byline: &[Value]) -> Value {
        json!({ "musicResponsiveListItemRenderer": {
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{
                    "text": format!("Song {video_id}"),
                    "navigationEndpoint": { "watchEndpoint": { "videoId": video_id } }
                }] } } },
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": byline } } }
            ],
            "playlistItemData": { "videoId": video_id }
        } })
    }

    fn search(card: &Value) -> Value {
        json!({ "contents": { "tabbedSearchResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
            "sectionListRenderer": { "contents": [card] } } } }] } } })
    }

    fn songs(page: &SearchSummaryPage) -> Vec<&crate::models::music::SongItem> {
        page.summaries[0]
            .items
            .iter()
            .filter_map(|item| match item {
                YTItem::Song(song) => Some(song),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn songs_under_an_artist_top_result_are_credited_to_that_artist_not_their_byline() {
        let separator = json!({ "text": " \u{2022} " });
        let by_acdc = json!({ "text": "AC/DC", "navigationEndpoint": browse(ACDC, "MUSIC_PAGE_TYPE_ARTIST") });
        let card = json!({ "musicCardShelfRenderer": {
            "header": { "musicCardShelfHeaderBasicRenderer": { "title": { "runs": [{ "text": "Top result" }] } } },
            "title": { "runs": [{ "text": "AC/DC" }] },
            "subtitle": { "runs": [{ "text": "Artist" }] },
            "onTap": browse(ACDC, "MUSIC_PAGE_TYPE_ARTIST"),
            "contents": [
                song_row("c1", &[json!({ "text": "Song" }), separator.clone(), json!({ "text": "4:38" })]),
                song_row("s1", &[json!({ "text": "Song" }), separator, by_acdc]),
            ]
        } });

        let page = parse_summary(&search(&card));
        let songs = songs(&page);
        assert_eq!(songs.len(), 2);
        for song in songs {
            assert_eq!(song.artists.len(), 1, "{}", song.id);
            assert_eq!(song.artists[0].name, "AC/DC");
            assert_eq!(song.artists[0].id.as_deref(), Some(ACDC));
        }
    }

    #[test]
    fn songs_under_a_song_top_result_keep_their_own_byline() {
        let card = json!({ "musicCardShelfRenderer": {
            "title": { "runs": [{ "text": "Thunderstruck" }] },
            "subtitle": { "runs": [{ "text": "Song" }] },
            "onTap": { "watchEndpoint": { "videoId": "top" } },
            "contents": [song_row("c1", &[json!({ "text": "Song" }), json!({ "text": "4:38" })])]
        } });

        let page = parse_summary(&search(&card));
        let card_song = songs(&page)
            .into_iter()
            .find(|song| song.id == "c1")
            .unwrap();
        assert_eq!(card_song.artists[0].id, None);
        assert_eq!(card_song.duration, Some(278));
    }
}
