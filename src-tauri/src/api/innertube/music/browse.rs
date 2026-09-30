//! Browse-surface extractors: home, explore, charts, moods & genres, new
//! releases, and mood/genre detail. All anonymous, all `WEB_REMIX` via
//! [`InnertubeClient::music_browse`].

use base64::Engine;
use serde_json::{Value, json};

use super::clients;
use super::endpoints;
use super::parse::endpoint::{browse_id, browse_params};
use super::parse::runs::runs_text;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::music::{
    AlbumItem, ChartSection, ChartsPage, ExplorePage, MoodAndGenreGroup, MoodAndGenreItem, YTItem,
};
use crate::models::music_pages::{MoodGenrePage, MusicHomePage, MusicShelf};

impl InnertubeClient {
    /// Typed music home (carousels + chips), with continuation paging.
    pub(crate) async fn music_home_page(
        &self,
        continuation_token: Option<&str>,
    ) -> AppResult<MusicHomePage> {
        let visitor = self.music_visitor_data().await;
        let res = if let Some(c) = continuation_token {
            self.music_browse(None, None, Some(c), visitor.as_deref())
                .await?
        } else {
            self.music_browse(Some(endpoints::BROWSE_HOME), None, None, visitor.as_deref())
                .await?
        };

        let chips = shelves::parse_chips(&res);
        let mut sections: Vec<MusicShelf> = Vec::new();

        let mut content_arrays: Vec<Value> = shelves::section_list_contents(&res);
        if let Some(arr) =
            res["continuationContents"]["sectionListContinuation"]["contents"].as_array()
        {
            content_arrays.extend(arr.iter().cloned());
        }
        if let Some(actions) = res["onResponseReceivedActions"].as_array() {
            for action in actions {
                if let Some(arr) =
                    action["appendContinuationItemsAction"]["continuationItems"].as_array()
                {
                    content_arrays.extend(arr.iter().cloned());
                }
            }
        }
        for section in &content_arrays {
            if let Some(shelf) = shelves::parse_section(section) {
                sections.push(shelf);
            }
        }

        let section_list = &res["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
            ["content"]["sectionListRenderer"];
        let cont_node = &res["continuationContents"]["sectionListContinuation"];
        let next = continuation::from_continuations(section_list)
            .or_else(|| continuation::from_continuations(cont_node))
            .or_else(|| continuation::from_continuations(&res["contents"]["sectionListRenderer"]))
            .or_else(|| continuation::from_items(&section_list["contents"]))
            .or_else(|| continuation::from_items(&cont_node["contents"]))
            .or_else(|| {
                res["onResponseReceivedActions"]
                    .as_array()
                    .and_then(|actions| {
                        actions.iter().find_map(|a| {
                            continuation::from_items(
                                &a["appendContinuationItemsAction"]["continuationItems"],
                            )
                        })
                    })
            });

        Ok(MusicHomePage {
            chips,
            sections,
            continuation: next,
        })
    }

    /// Explore page = new-release albums + moods/genres (each its own browse).
    pub(crate) async fn music_explore_page(&self) -> AppResult<ExplorePage> {
        let new_release_albums = self.music_new_releases().await.unwrap_or_default();
        let mood_and_genres = self.music_moods().await.unwrap_or_default();
        Ok(ExplorePage {
            new_release_albums,
            mood_and_genres,
        })
    }

    /// New-release albums grid.
    pub(crate) async fn music_new_releases(&self) -> AppResult<Vec<AlbumItem>> {
        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(
                Some(endpoints::BROWSE_NEW_RELEASES),
                None,
                None,
                visitor.as_deref(),
            )
            .await?;
        let mut albums = Vec::new();
        for section in shelves::section_list_contents(&res) {
            if let Some(shelf) = shelves::parse_section(&section) {
                for item in shelf.items {
                    if let YTItem::Album(a) = item {
                        albums.push(a);
                    }
                }
            }
        }
        Ok(albums)
    }

    /// Mood & genre navigation buttons.
    pub(crate) async fn music_moods(&self) -> AppResult<Vec<MoodAndGenreItem>> {
        Ok(self
            .music_mood_groups()
            .await?
            .into_iter()
            .flat_map(|group| group.items)
            .collect())
    }

    pub(crate) async fn music_mood_groups(&self) -> AppResult<Vec<MoodAndGenreGroup>> {
        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(
                Some(endpoints::BROWSE_MOODS),
                None,
                None,
                visitor.as_deref(),
            )
            .await?;
        Ok(parse_mood_groups(&res))
    }

    /// Browse into a mood/genre (grid of playlists), with paging.
    pub(crate) async fn music_mood_genre(
        &self,
        browse_id_str: &str,
        params: Option<&str>,
        continuation_token: Option<&str>,
    ) -> AppResult<MoodGenrePage> {
        let visitor = self.music_visitor_data().await;
        let res = if let Some(c) = continuation_token {
            self.music_browse(None, None, Some(c), visitor.as_deref())
                .await?
        } else {
            self.music_browse(Some(browse_id_str), params, None, visitor.as_deref())
                .await?
        };

        let title = runs_text(&res["header"]["musicHeaderRenderer"]["title"]).unwrap_or_default();
        let mut items: Vec<YTItem> = Vec::new();
        let mut next: Option<String> = None;

        for section in shelves::section_list_contents(&res) {
            if let Some(shelf) = shelves::parse_section(&section) {
                items.extend(shelf.items);
            }
            if next.is_none() {
                next = section_shelf_continuation(&section);
            }
        }

        let cont = &res["continuationContents"];
        for node in [
            &cont["musicPlaylistShelfContinuation"],
            &cont["musicShelfContinuation"],
        ] {
            items.extend(shelves::collect_items(&node["contents"]));
            if next.is_none() {
                next = continuation::any(node, &node["contents"]);
            }
        }
        let grid = &cont["gridContinuation"];
        items.extend(shelves::collect_items(&grid["items"]));
        if next.is_none() {
            next = continuation::any(grid, &grid["items"]);
        }
        let append = &res["onResponseReceivedActions"][0]["appendContinuationItemsAction"]["continuationItems"];
        items.extend(shelves::collect_items(append));
        if next.is_none() {
            next = continuation::from_items(append);
        }

        if next.is_none() {
            next = continuation::from_continuations(&res["contents"]["sectionListRenderer"])
                .or_else(|| {
                    continuation::from_continuations(
                        &res["continuationContents"]["sectionListContinuation"],
                    )
                });
        }

        Ok(MoodGenrePage {
            title,
            items,
            continuation: next,
        })
    }

    /// Music charts (trending / top / genres), with paging.
    pub(crate) async fn music_charts_page(
        &self,
        continuation_token: Option<&str>,
        country: Option<&str>,
    ) -> AppResult<ChartsPage> {
        let visitor = self.music_visitor_data().await;
        let res = if let Some(c) = continuation_token {
            self.music_browse(None, None, Some(c), visitor.as_deref())
                .await?
        } else {
            let mut payload = json!({
                "browseId": endpoints::BROWSE_CHARTS,
                "params": endpoints::CHARTS_PARAMS,
            });
            if let Some(code) = country.filter(|code| {
                code.len() == 2 && code.bytes().all(|byte| byte.is_ascii_uppercase())
            }) {
                payload["formData"] = json!({ "selectedValues": [code] });
            }
            self.post_music(
                "browse",
                &clients::WEB_REMIX,
                &mut payload,
                visitor.as_deref(),
                None,
            )
            .await?
        };

        let mut sections: Vec<ChartSection> = Vec::new();
        for section in shelves::section_list_contents(&res) {
            if let Some(shelf) = shelves::parse_section(&section) {
                if shelf.items.is_empty() {
                    continue;
                }
                sections.push(ChartSection {
                    chart_type: determine_chart_type(&shelf, &section),
                    title: shelf.title,
                    items: shelf.items,
                });
            }
        }

        let next = continuation::from_continuations(&res["contents"]["sectionListRenderer"])
            .or_else(|| {
                continuation::from_continuations(
                    &res["continuationContents"]["sectionListContinuation"],
                )
            });
        let selected = selected_chart_country(&res);

        Ok(ChartsPage {
            sections,
            country_code: selected.as_ref().and_then(|(code, _)| code.clone()),
            country_label: selected.map(|(_, label)| label),
            continuation: next,
        })
    }
}

fn section_shelf_continuation(section: &Value) -> Option<String> {
    for key in [
        "gridRenderer",
        "musicPlaylistShelfRenderer",
        "musicShelfRenderer",
    ] {
        let node = &section[key];
        if node.is_null() {
            continue;
        }
        let items = if node["items"].is_array() {
            &node["items"]
        } else {
            &node["contents"]
        };
        if let Some(token) = continuation::any(node, items) {
            return Some(token);
        }
    }
    None
}

fn parse_mood_button(btn: &Value) -> Option<MoodAndGenreItem> {
    let r = &btn["musicNavigationButtonRenderer"];
    let title = runs_text(&r["buttonText"])?;
    let stripe_color = r["solid"]["leftStripeColor"].as_u64().unwrap_or(0);
    let nav = &r["clickCommand"];
    let browse = browse_id(nav)?;
    Some(MoodAndGenreItem {
        title,
        stripe_color,
        browse_id: browse,
        params: browse_params(nav),
    })
}

fn determine_chart_type(shelf: &MusicShelf, section: &Value) -> String {
    if section.get("gridRenderer").is_some() {
        return "NewReleases".to_string();
    }
    let mut songs = false;
    let mut playlists = false;
    let mut artists = false;
    let mut other = false;
    for item in &shelf.items {
        match item {
            YTItem::Song(_) => songs = true,
            YTItem::Playlist(_) => playlists = true,
            YTItem::Artist(_) => artists = true,
            _ => other = true,
        }
    }
    match (songs, playlists, artists, other) {
        (true, false, false, false) => "Songs",
        (false, true, false, false) => "Playlists",
        (false, false, true, false) => "Artists",
        _ => "Mixed",
    }
    .to_string()
}

#[cfg(test)]
mod mood_group_tests {
    use super::*;

    #[test]
    fn preserves_groups_without_using_english_titles() {
        let response = json!({ "contents": { "sectionListRenderer": { "contents": [
            { "gridRenderer": {
                "header": { "gridHeaderRenderer": { "title": { "runs": [{ "text": "Énergies" }] } } },
                "items": [{ "musicNavigationButtonRenderer": {
                    "buttonText": { "runs": [{ "text": "Calme" }] },
                    "clickCommand": { "browseEndpoint": { "browseId": "FEmusic_mood_calm" } }
                } }]
            } }
        ] } } });
        let groups = parse_mood_groups(&response);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "Énergies");
        assert_eq!(groups[0].items[0].title, "Calme");
    }
}

fn parse_mood_groups(res: &Value) -> Vec<MoodAndGenreGroup> {
    let mut groups = Vec::new();
    for section in shelves::section_list_contents(res) {
        let title = runs_text(&section["gridRenderer"]["header"]["gridHeaderRenderer"]["title"])
            .or_else(|| runs_text(&section["musicCarouselShelfRenderer"]["header"]
                ["musicCarouselShelfBasicHeaderRenderer"]["title"]))
            .unwrap_or_default();
        let buttons = section["gridRenderer"]["items"]
            .as_array()
            .or_else(|| section["musicCarouselShelfRenderer"]["contents"].as_array());
        let items: Vec<_> = buttons
            .into_iter()
            .flatten()
            .filter_map(parse_mood_button)
            .collect();
        if !items.is_empty() {
            groups.push(MoodAndGenreGroup { title, items });
        }
    }
    groups
}

/// The chart country the response is actually for. The country menu marks the
/// active option by omitting its `selectedCommand`; `ZZ` is Global.
fn selected_chart_country(value: &Value) -> Option<(Option<String>, String)> {
    if let Some(button) = value.get("musicSortFilterButtonRenderer") {
        let options = button["menu"]["musicMultiSelectMenuRenderer"]["options"].as_array()?;
        let selected = options
            .iter()
            .filter_map(|option| option.get("musicMultiSelectMenuItemRenderer"))
            .find(|option| option.get("selectedCommand").is_none())?;
        let code = country_from_entity_key(selected["formItemEntityKey"].as_str()?)?;
        let label = runs_text(&selected["title"]).or_else(|| runs_text(&button["title"]))?;
        return Some(((code != "ZZ").then_some(code), label));
    }
    match value {
        Value::Array(values) => values.iter().find_map(selected_chart_country),
        Value::Object(values) => values.values().find_map(selected_chart_country),
        _ => None,
    }
}

fn country_from_entity_key(key: &str) -> Option<String> {
    let key = key
        .replace("%3D", "=")
        .replace("%2B", "+")
        .replace("%2F", "/");
    let bytes = base64::engine::general_purpose::STANDARD.decode(key).ok()?;
    let start = bytes
        .windows(13)
        .position(|window| window == b"country_menu_")?
        + 13;
    let tail = &bytes[start..];
    let digits = tail.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let code = tail.get(digits..digits + 2)?;
    code.iter()
        .all(u8::is_ascii_uppercase)
        .then(|| String::from_utf8_lossy(code).into_owned())
}

#[cfg(test)]
mod chart_tests {
    use super::*;
    use crate::models::music::ArtistItem;

    #[test]
    fn chart_kind_uses_items_when_title_is_localized() {
        let shelf = MusicShelf {
            title: "أفضل الفنانين".into(),
            subtitle: None,
            browse_id: None,
            params: None,
            items: vec![YTItem::Artist(ArtistItem {
                id: "UCartist".into(),
                title: "Artist".into(),
                thumbnail: None,
                channel_id: None,
            })],
        };
        assert_eq!(
            determine_chart_type(&shelf, &json!({"musicCarouselShelfRenderer": {}})),
            "Artists"
        );
    }

    fn country_option(code: &str, label: &str, active: bool) -> Value {
        let key = base64::engine::general_purpose::STANDARD
            .encode(format!(
                "\u{12}'explore_charts_country_menu_316766567{code} "
            ))
            .replace('=', "%3D");
        let mut option = json!({ "musicMultiSelectMenuItemRenderer": {
            "title": { "runs": [{ "text": label }] },
            "formItemEntityKey": key,
        } });
        if !active {
            option["musicMultiSelectMenuItemRenderer"]["selectedCommand"] = json!({});
        }
        option
    }

    fn charts_with_menu(options: &[Value]) -> Value {
        json!({ "contents": { "sectionListRenderer": { "contents": [{ "musicShelfRenderer": {
            "subheaders": [{ "musicSideAlignedItemRenderer": { "startItems": [{
                "musicSortFilterButtonRenderer": { "menu": { "musicMultiSelectMenuRenderer": {
                    "options": options
                } } }
            }] } }]
        } }] } } })
    }

    #[test]
    fn chart_country_comes_from_the_active_menu_option() {
        let response = charts_with_menu(&[
            country_option("ZZ", "Global", false),
            json!({ "musicMenuItemDividerRenderer": {} }),
            country_option("AR", "Argentina", true),
        ]);
        assert_eq!(
            selected_chart_country(&response),
            Some((Some("AR".to_owned()), "Argentina".to_owned())),
        );
    }

    #[test]
    fn unsupported_country_reports_global_fallback() {
        // A request for LB returns the default menu with Global active.
        let response = charts_with_menu(&[
            country_option("ZZ", "Mondial", true),
            country_option("AR", "Argentine", false),
        ]);
        assert_eq!(
            selected_chart_country(&response),
            Some((None, "Mondial".to_owned()))
        );
    }

    #[test]
    fn video_and_artist_only_charts_yield_no_song_rows() {
        let video = MusicShelf {
            title: "Video charts".into(),
            subtitle: None,
            browse_id: None,
            params: None,
            items: vec![YTItem::Playlist(crate::models::music::PlaylistItem {
                id: "PL".into(),
                title: "Top videos".into(),
                author: None,
                song_count_text: None,
                thumbnail: None,
            })],
        };
        assert_eq!(
            determine_chart_type(&video, &json!({"musicCarouselShelfRenderer": {}})),
            "Playlists"
        );
    }
}
