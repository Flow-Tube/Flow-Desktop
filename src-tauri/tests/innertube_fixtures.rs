//! Checks the shared `InnerTube` readers against real captured responses.
//!
//! The captures are not committed. Regenerate them with
//! `cargo test --test innertube_capture -- --ignored`; until then each test
//! notes the missing file and passes, so CI does not cover these. Set
//! `FLOW_REQUIRE_FIXTURES=1` to make a missing capture fail instead.

use std::path::PathBuf;

use flow_desktop_lib::api::innertube::extractors::comments::parse_comments_json;
use flow_desktop_lib::api::innertube::extractors::search::parse_innertube_search;
use flow_desktop_lib::api::innertube::extractors::watch_next;
use flow_desktop_lib::api::innertube::json::age::relative_age;
use flow_desktop_lib::api::innertube::json::continuation::{
    continuation_item_lists, continuation_token,
};
use flow_desktop_lib::api::innertube::renderers::lockup::lockup_item;
use serde_json::Value;

fn fixture(name: &str) -> Option<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/innertube")
        .join(format!("{name}.json"));
    match std::fs::read(&path) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).expect("capture is JSON")),
        Err(_) if std::env::var_os("FLOW_REQUIRE_FIXTURES").is_some() => {
            panic!("missing capture {}", path.display())
        }
        Err(_) => {
            eprintln!(
                "skipped: {} is missing; regenerate with `cargo test --test innertube_capture -- --ignored`",
                path.display()
            );
            None
        }
    }
}

fn find_all<'a>(value: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if k == key {
                    out.push(v);
                }
                find_all(v, key, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| find_all(v, key, out)),
        _ => {}
    }
}

#[test]
fn related_cards_carry_dates_the_age_reader_understands() {
    let Some(next) = fixture("next_related") else {
        return;
    };
    let mut lockups = Vec::new();
    find_all(
        &next["contents"]["twoColumnWatchNextResults"]["secondaryResults"],
        "lockupViewModel",
        &mut lockups,
    );
    let videos: Vec<&Value> = lockups
        .into_iter()
        .filter(|lockup| lockup["contentType"] == "LOCKUP_CONTENT_TYPE_VIDEO")
        .collect();
    assert!(!videos.is_empty(), "related lane has video lockups");
    let dated = videos
        .iter()
        .filter(|lockup| {
            let mut parts = Vec::new();
            find_all(&lockup["metadata"], "metadataParts", &mut parts);
            parts
                .iter()
                .filter_map(|list| list.as_array())
                .flatten()
                .filter_map(|part| part["text"]["content"].as_str())
                .any(|text| relative_age(text).is_some())
        })
        .count();
    assert!(
        dated * 10 >= videos.len() * 8,
        "only {dated} of {} related videos had a readable age",
        videos.len()
    );
}

#[test]
fn playlist_first_page_hands_out_a_view_model_token() {
    let Some(page) = fixture("playlist_page1") else {
        return;
    };
    let mut view_models = Vec::new();
    find_all(&page, "continuationItemViewModel", &mut view_models);
    let wrapped: Vec<Value> = view_models
        .into_iter()
        .map(|vm| serde_json::json!({ "continuationItemViewModel": vm }))
        .collect();
    assert!(
        wrapped
            .iter()
            .any(|item| continuation_token(item).is_some()),
        "page 1 of a long playlist carries a continuationItemViewModel token"
    );
}

#[test]
fn playlist_later_pages_arrive_in_an_append_action() {
    let Some(page) = fixture("playlist_page2") else {
        return;
    };
    let lists = continuation_item_lists(&page);
    let lockups = lists
        .iter()
        .flat_map(|list| list.iter())
        .filter(|item| item.get("lockupViewModel").is_some())
        .count();
    assert!(lockups >= 50, "page 2 delivered {lockups} lockups");
}

#[test]
fn channel_search_later_pages_wrap_results_in_item_sections() {
    let Some(page) = fixture("channel_search_page2") else {
        return;
    };
    let lists = continuation_item_lists(&page);
    let wrapped = lists
        .iter()
        .flat_map(|list| list.iter())
        .filter(|item| item["itemSectionRenderer"]["contents"].is_array())
        .count();
    assert!(
        wrapped > 0,
        "page 2 wraps its results in itemSectionRenderer"
    );
}

#[test]
fn related_lockups_parse_with_counts_dates_and_channels() {
    let Some(next) = fixture("next_related") else {
        return;
    };
    let mut lockups = Vec::new();
    find_all(
        &next["contents"]["twoColumnWatchNextResults"]["secondaryResults"],
        "lockupViewModel",
        &mut lockups,
    );
    let items: Vec<_> = lockups
        .into_iter()
        .filter(|lockup| lockup["contentType"] == "LOCKUP_CONTENT_TYPE_VIDEO")
        .filter_map(lockup_item)
        .collect();
    assert!(!items.is_empty());
    let complete = items
        .iter()
        .filter(|item| {
            !item.channel_name.is_empty()
                && item.channel_id.is_some()
                && (item.is_live
                    || (item.view_count_text.is_some() && item.published_text.is_some()))
        })
        .count();
    assert!(
        complete * 10 >= items.len() * 9,
        "only {complete} of {} related lockups had a channel, count and date",
        items.len()
    );
}

#[test]
fn the_watch_answer_gives_the_owner_block_hashtags_and_autoplay() {
    let Some(next) = fixture("next_related") else {
        return;
    };
    let owner = watch_next::owner(&next);
    assert_eq!(
        owner.channel_id.as_deref(),
        Some("UCuAXFkgsw1L7xaCfnd5JJOw")
    );
    assert!(owner.avatar_url.is_some());
    assert!(owner.subscriber_count_text.is_some());
    assert_eq!(owner.badge, Some("artist"));
    let primary = watch_next::primary(&next);
    assert!(primary.published_text.is_some() && primary.relative_published_text.is_some());
    assert!(primary.hashtags.iter().all(|tag| tag.starts_with('#')));
    assert!(watch_next::autoplay_video_id(&next).is_some());
    let page = watch_next::related_page(&next);
    assert!(page.items.len() >= 10, "{} related items", page.items.len());
    assert!(page.continuation.is_some());
}

#[test]
fn the_related_lane_continues() {
    let Some(page2) = fixture("next_related_page2") else {
        return;
    };
    let page = watch_next::related_page(&page2);
    assert!(page.items.len() >= 10, "{} related items", page.items.len());
}

#[test]
fn auto_chapters_and_the_heatmap_are_read_from_the_watch_answer() {
    let Some(next) = fixture("next_auto_chapters") else {
        return;
    };
    let (chapters, auto) = watch_next::chapters(&next, 3600);
    assert!(auto);
    assert!(chapters.len() >= 3, "{} chapters", chapters.len());
    assert_eq!(chapters[0].start_seconds, 0);
    assert!(
        chapters
            .iter()
            .all(|chapter| chapter.thumbnail_url.is_some())
    );
    assert!(!watch_next::heatmap(&next).is_empty());
}

#[test]
fn a_collaboration_names_every_channel() {
    let Some(next) = fixture("next_collab") else {
        return;
    };
    let owner = watch_next::owner(&next);
    assert!(owner.collaborators.len() >= 2, "{:?}", owner.collaborators);
    assert!(owner.name.is_some() && owner.channel_id.is_some());
}

#[test]
fn the_description_carries_its_links_songs_and_numbers() {
    let Some(next) = fixture("next_related") else {
        return;
    };
    let rich =
        watch_next::description_rich(&next, None, "dQw4w9WgXcQ").expect("linked description");
    assert!(!rich.spans.is_empty());
    let extras = watch_next::description_extras(&next);
    assert!(!extras.factoids.is_empty());
    assert!(!extras.music.is_empty());
    assert!(
        extras
            .links
            .iter()
            .all(|link| !link.url.contains("/redirect?"))
    );
}

#[test]
fn a_comments_page_has_its_sort_options_and_exact_count() {
    let Some(page) = fixture("comments_page1") else {
        return;
    };
    let parsed = parse_comments_json(&page, Some("dQw4w9WgXcQ"));
    assert!(
        parsed.comments.len() >= 10,
        "{} comments",
        parsed.comments.len()
    );
    assert_eq!(parsed.sort_options.len(), 2);
    assert!(parsed.total_count.is_some_and(|count| count > 1_000_000));
    assert!(parsed.next_page_token.is_some());
}

#[test]
fn turned_off_comments_are_detected() {
    let Some(next) = fixture("next_comments_off") else {
        return;
    };
    assert!(parse_comments_json(&next, Some("XqZsoesa55w")).comments_disabled);
}

#[test]
fn a_mixed_search_keeps_its_channel_shelves_and_shorts() {
    let Some(page) = fixture("search_plain") else {
        return;
    };
    let page = parse_innertube_search(&page);
    assert!(page.items.len() >= 10, "{} videos", page.items.len());
    let channel = page.channels.first().expect("channel card");
    assert!(
        channel
            .handle
            .as_deref()
            .is_some_and(|handle| handle.starts_with('@'))
    );
    assert!(
        channel
            .subscriber_count_text
            .as_deref()
            .is_some_and(|text| text.contains("subscriber"))
    );
    assert!(!page.shelves.is_empty());
    assert!(page.shorts.len() >= 10, "{} shorts", page.shorts.len());
    assert!(page.next_page_token.is_some());
}

#[test]
fn typed_searches_return_their_type() {
    if let Some(page) = fixture("search_shorts") {
        assert!(parse_innertube_search(&page).shorts.len() >= 20);
    }
    if let Some(page) = fixture("search_playlists") {
        let page = parse_innertube_search(&page);
        assert!(
            page.playlists.len() >= 10,
            "{} playlists",
            page.playlists.len()
        );
        assert!(
            page.playlists
                .iter()
                .all(|playlist| !playlist.title.is_empty())
        );
    }
    if let Some(page) = fixture("search_channels") {
        assert!(parse_innertube_search(&page).channels.len() >= 15);
    }
}

#[test]
fn a_misspelt_search_says_what_it_searched_for() {
    let Some(page) = fixture("search_corrected") else {
        return;
    };
    let correction = parse_innertube_search(&page)
        .correction
        .expect("correction");
    assert!(correction.applied);
    assert_eq!(correction.original.as_deref(), Some("linus tehc tips"));
}
