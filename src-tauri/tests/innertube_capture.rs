//! Regenerates the `InnerTube` captures `innertube_fixtures.rs` reads.
//!
//! Run by hand, never in CI: `cargo test --test innertube_capture -- --ignored`.
//! It goes through the app's own transport, so the captures carry the headers
//! and context the app really sends. They land in `tests/fixtures/innertube/`,
//! which git ignores: captured responses are never committed.

use std::path::PathBuf;

use flow_desktop_lib::api::innertube::InnertubeClient;
use flow_desktop_lib::api::innertube::core::clients;
use flow_desktop_lib::api::innertube::json::continuation::{
    continuation_item_lists, last_continuation_token,
};
use serde_json::{Value, json};

const LTT: &str = "UCXuqSBlHAE6Xw-yeJA0Tunw";
const WAN_SHOW: &str = "VLPL8mG-RkN2uTw7PhlnAr4pZZz2QubIbujH";
const CHANNEL_SEARCH_PARAMS: &str = "EgZzZWFyY2jyBgQKAloA";

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/innertube")
}

/// Drops the tracking fields that make up much of a response and change on
/// every request.
fn trim(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|key, _| {
                !matches!(
                    key.as_str(),
                    "trackingParams" | "clickTrackingParams" | "loggingContext"
                )
            });
            map.values_mut().for_each(trim);
        }
        Value::Array(items) => items.iter_mut().for_each(trim),
        _ => {}
    }
}

/// An artist with albums, singles, videos, featured playlists and related artists.
const MUSIC_ARTIST: &str = "UClYV6hHlupm_S_ObS1W-DYw";
/// A podcast whose playlist page lists episodes without a header.
const PODCAST: &str = "PLYWnygDGxPqWiCM5_kihM28jfWiQTNYDa";

/// A YouTube Music request as the web client sends it, signed out.
async fn music_post(endpoint: &str, mut body: Value) -> Value {
    body["context"] = json!({ "client": {
        "clientName": "WEB_REMIX", "clientVersion": "1.20260708.01.00", "hl": "en", "gl": "US"
    } });
    flow_desktop_lib::api::http::shared_client()
        .post(format!(
            "https://music.youtube.com/youtubei/v1/{endpoint}?prettyPrint=false"
        ))
        .header("Origin", "https://music.youtube.com")
        .json(&body)
        .send()
        .await
        .expect("music request")
        .json()
        .await
        .expect("music json")
}

fn save(name: &str, mut response: Value) -> Value {
    trim(&mut response);
    std::fs::create_dir_all(fixture_dir()).expect("fixture dir");
    let path = fixture_dir().join(format!("{name}.json"));
    std::fs::write(&path, serde_json::to_vec_pretty(&response).expect("json")).expect("write");
    println!("saved {}", path.display());
    response
}

/// The next-page token of a first page's own item list, the last item of the
/// tab's first section. Other shelves on the page carry tokens of their own.
fn first_page_token(page: &Value) -> Option<String> {
    let sections = page["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        .as_array()?
        .iter()
        .find_map(|tab| {
            tab["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array()
        })?;
    sections.iter().find_map(|section| {
        let items = section["itemSectionRenderer"]["contents"].as_array()?;
        last_continuation_token(items).or_else(|| {
            items.iter().find_map(|item| {
                item["playlistVideoListRenderer"]["contents"]
                    .as_array()
                    .and_then(|list| last_continuation_token(list))
            })
        })
    })
}

/// The next-page token of a channel search: the last item of the search tab's
/// section list.
fn channel_search_token(page: &Value) -> Option<String> {
    page["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        .as_array()?
        .iter()
        .filter_map(|tab| {
            tab.get("expandableTabRenderer")
                .or_else(|| tab.get("tabRenderer"))
        })
        .filter(|tab| tab["selected"].as_bool() == Some(true))
        .find_map(|tab| {
            tab["content"]["sectionListRenderer"]["contents"]
                .as_array()
                .and_then(|sections| last_continuation_token(sections))
        })
        .or_else(|| {
            continuation_item_lists(page)
                .into_iter()
                .find_map(|list| last_continuation_token(list))
        })
}

/// A channel whose posts include quizzes and polls.
const QUIZ_CHANNEL: &str = "UCHnyfMqiRRG1u-2MsSQLbXA";
/// A video with YouTube-generated chapters and a heatmap.
const AUTO_CHAPTERS_VIDEO: &str = "0e3GPea1Tyg";
/// A collaboration between two channels.
const COLLAB_VIDEO: &str = "a-iReT6fwVI";
/// A video made for kids, whose comments are turned off.
const COMMENTS_OFF_VIDEO: &str = "XqZsoesa55w";

/// The token for the first comments page, in the watch answer's comment section.
fn comments_token(next: &Value) -> Option<String> {
    next["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"]
        .as_array()?
        .iter()
        .map(|content| &content["itemSectionRenderer"])
        .find(|section| section["sectionIdentifier"] == "comment-item-section")?["contents"]
        .as_array()?
        .iter()
        .find_map(|item| {
            item["continuationItemRenderer"]["continuationEndpoint"]["continuationCommand"]["token"]
                .as_str()
        })
        .map(ToOwned::to_owned)
}

#[tokio::test]
#[ignore = "network: regenerates the InnerTube captures"]
async fn capture_innertube_fixtures() {
    let client = InnertubeClient::new();

    let mut next = json!({ "videoId": "dQw4w9WgXcQ", "contentCheckOk": true, "racyCheckOk": true });
    let next = client
        .post_innertube("next", &clients::WEB, &mut next)
        .await
        .expect("next");
    let next = save("next_related", next);
    let token = flow_desktop_lib::api::innertube::extractors::watch_next::related_page(&next)
        .continuation
        .expect("related page 2 token");
    let mut page2 = json!({ "continuation": token });
    let page2 = client
        .post_innertube("next", &clients::WEB, &mut page2)
        .await
        .expect("related page 2");
    save("next_related_page2", page2);

    let token = comments_token(&next).expect("comments token");
    let mut comments = json!({ "continuation": token });
    let comments = client
        .post_innertube("next", &clients::WEB, &mut comments)
        .await
        .expect("comments");
    save("comments_page1", comments);

    for (name, query, params) in [
        ("search_plain", "linus tech tips", None),
        ("search_shorts", "cat", Some("EgIQCQ==")),
        ("search_playlists", "lofi", Some("EgIQAw==")),
        ("search_channels", "cooking", Some("EgIQAg==")),
        ("search_corrected", "linus tehc tips", None),
    ] {
        let mut search = json!({ "query": query });
        if let Some(params) = params {
            search["params"] = json!(params);
        }
        let search = client
            .post_innertube("search", &clients::WEB, &mut search)
            .await
            .expect(name);
        save(name, search);
    }

    for (name, browse_id, params) in [
        ("explore_live", "UC4R8DWoMoI7CAwX8_LjQHig", None),
        (
            "explore_gaming",
            "UCOpNcN46UbXVtpKMrmU4Abg",
            Some("Egh0cmVuZGluZw%3D%3D"),
        ),
        ("explore_news", "FEnews_destination", None),
        (
            "explore_live_grid",
            "UC4R8DWoMoI7CAwX8_LjQHig",
            Some("EgdsaXZldGFikgEDCKEK"),
        ),
    ] {
        let mut browse = json!({ "browseId": browse_id });
        if let Some(params) = params {
            browse["params"] = json!(params);
        }
        let page = client
            .post_innertube("browse", &clients::WEB, &mut browse)
            .await
            .expect(name);
        save(name, page);
    }

    let rss = flow_desktop_lib::api::http::shared_client()
        .get(format!(
            "https://www.youtube.com/feeds/videos.xml?channel_id={LTT}"
        ))
        .send()
        .await
        .expect("rss")
        .text()
        .await
        .expect("rss body");
    std::fs::write(fixture_dir().join("rss_ltt.xml"), rss).expect("write rss");

    for (name, endpoint, body) in [
        (
            "music_search_weeknd",
            "search",
            json!({ "query": "the weeknd" }),
        ),
        (
            "music_podcast_vl",
            "browse",
            json!({ "browseId": format!("VL{PODCAST}") }),
        ),
        (
            "music_artist",
            "browse",
            json!({ "browseId": MUSIC_ARTIST }),
        ),
    ] {
        save(name, music_post(endpoint, body).await);
    }

    let mut landing = json!({ "browseId": LTT });
    let landing = client
        .post_innertube("browse", &clients::WEB, &mut landing)
        .await
        .expect("channel landing");
    let landing = save("channel_home", landing);
    let details =
        flow_desktop_lib::api::innertube::extractors::channel::parse_header(&landing, LTT);
    for tab in &details.tabs {
        let Some(params) = &tab.params else { continue };
        if !["videos", "shorts", "live", "playlists", "posts"].contains(&tab.kind.as_str()) {
            continue;
        }
        let mut browse = json!({ "browseId": LTT, "params": params });
        let page = client
            .post_innertube("browse", &clients::WEB, &mut browse)
            .await
            .expect("channel tab");
        let page = save(&format!("channel_{}", tab.kind), page);
        if tab.kind != "videos" {
            continue;
        }
        let tab = flow_desktop_lib::api::innertube::extractors::channel::parse_tab(&page, LTT);
        let popular = tab
            .filters
            .iter()
            .flat_map(|group| &group.options)
            .find(|option| !option.selected && option.continuation.is_some())
            .and_then(|option| option.continuation.clone())
            .expect("a second sort");
        let mut sorted = json!({ "continuation": popular });
        let sorted = client
            .post_innertube("browse", &clients::WEB, &mut sorted)
            .await
            .expect("sorted videos");
        save("channel_videos_sorted", sorted);
    }
    let token = details.about_token.expect("about token");
    let mut about = json!({ "continuation": token });
    let about = client
        .post_innertube("browse", &clients::WEB, &mut about)
        .await
        .expect("channel about");
    save("channel_about", about);
    let mut quiz_posts = json!({ "browseId": QUIZ_CHANNEL, "params": "EgVwb3N0c_IGBAoCSgA%3D" });
    let quiz_posts = client
        .post_innertube("browse", &clients::WEB, &mut quiz_posts)
        .await
        .expect("quiz posts");
    save("channel_posts_quiz", quiz_posts);

    for (name, video_id) in [
        ("next_auto_chapters", AUTO_CHAPTERS_VIDEO),
        ("next_collab", COLLAB_VIDEO),
        ("next_comments_off", COMMENTS_OFF_VIDEO),
    ] {
        let mut next = json!({ "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true });
        let next = client
            .post_innertube("next", &clients::WEB, &mut next)
            .await
            .expect(name);
        save(name, next);
    }

    let mut playlist = json!({ "browseId": WAN_SHOW });
    let first = client
        .post_innertube("browse", &clients::WEB, &mut playlist)
        .await
        .expect("playlist");
    let first = save("playlist_page1", first);
    let token = first_page_token(&first).expect("playlist page 2 token");
    let mut page2 = json!({ "continuation": token });
    let page2 = client
        .post_innertube("browse", &clients::WEB, &mut page2)
        .await
        .expect("playlist page 2");
    save("playlist_page2", page2);

    let mut search = json!({ "browseId": LTT, "params": CHANNEL_SEARCH_PARAMS, "query": "gpu" });
    let first = client
        .post_innertube("browse", &clients::WEB, &mut search)
        .await
        .expect("channel search");
    let first = save("channel_search_page1", first);
    let token = channel_search_token(&first).expect("channel search page 2 token");
    let mut page2 = json!({ "continuation": token });
    let page2 = client
        .post_innertube("browse", &clients::WEB, &mut page2)
        .await
        .expect("channel search page 2");
    save("channel_search_page2", page2);
}
