//! Responses in other content languages: dates, counts, channel headers and
//! music search read from real captures (`cargo test --test innertube_capture
//! -- --ignored` writes them). One test sets the process-wide language in turn,
//! so it lives in its own binary, away from the tests that assume English.

use std::path::PathBuf;

use flow_desktop_lib::api::innertube::core::locale;
use flow_desktop_lib::api::innertube::extractors::channel::parse_header;
use flow_desktop_lib::api::innertube::extractors::search::parse_innertube_search;
use flow_desktop_lib::api::innertube::extractors::watch_next;
use flow_desktop_lib::api::innertube::json::age::relative_age;
use flow_desktop_lib::api::innertube::music::search::parse_summary;
use flow_desktop_lib::api::innertube::renderers::lockup::related_to_video;
use flow_desktop_lib::models::music::YTItem;
use serde_json::Value;

const LANGUAGES: [&str; 6] = ["de", "fr", "ja", "es", "ru", "pt-BR"];

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
            eprintln!("skipped: {} is missing", path.display());
            None
        }
    }
}

/// At least four in five of `items` pass `test`, and there are enough to say so.
fn mostly<T>(items: &[T], test: impl Fn(&T) -> bool, what: &str, language: &str) {
    let passed = items.iter().filter(|item| test(item)).count();
    assert!(
        items.len() >= 5 && passed * 5 >= items.len() * 4,
        "{language}: {what} {passed}/{}",
        items.len()
    );
}

fn check(language: &str) {
    if let Some(page) = fixture(&format!("locale_search_{language}")) {
        let videos = parse_innertube_search(&page).items;
        let dated: Vec<_> = videos
            .iter()
            .filter_map(|video| video.published_text.as_deref())
            .collect();
        mostly(
            &dated,
            |text| relative_age(text).is_some(),
            "search ages",
            language,
        );
        let counted: Vec<u64> = videos.iter().filter_map(|video| video.view_count).collect();
        assert!(
            counted.len() * 2 >= videos.len(),
            "{language}: search counts {}/{}",
            counted.len(),
            videos.len()
        );
        assert!(
            counted.iter().all(|count| *count >= 1000),
            "{language}: a small count is a misread abbreviation"
        );
    }
    if let Some(next) = fixture(&format!("locale_next_{language}")) {
        let related: Vec<_> = watch_next::related_page(&next)
            .items
            .into_iter()
            .filter(|item| item.item_type == "video")
            .map(related_to_video)
            .collect();
        let dated: Vec<_> = related
            .iter()
            .filter_map(|video| video.published_text.as_deref())
            .collect();
        mostly(
            &dated,
            |text| relative_age(text).is_some(),
            "related ages",
            language,
        );
        mostly(
            &related,
            |video| video.view_count_text.is_some(),
            "related view texts",
            language,
        );
        assert!(
            related
                .iter()
                .filter_map(|video| video.view_count)
                .all(|count| count >= 1000),
            "{language}: a related count was misread"
        );
    }
    if let Some(page) = fixture(&format!("locale_channel_{language}")) {
        let header = parse_header(&page, "UCXuqSBlHAE6Xw-yeJA0Tunw");
        assert!(
            header
                .handle
                .as_deref()
                .is_some_and(|handle| handle.starts_with('@')),
            "{language}: handle"
        );
        let subscribers = header.subscriber_count_text.expect("subscriber count text");
        let videos = header.video_count_text.expect("video count text");
        assert_ne!(
            subscribers, videos,
            "{language}: subscribers and videos are told apart"
        );
        let kinds: Vec<&str> = header.tabs.iter().map(|tab| tab.kind.as_str()).collect();
        for kind in ["home", "videos", "shorts", "playlists", "posts"] {
            assert!(kinds.contains(&kind), "{language}: {kind} tab in {kinds:?}");
        }
    }
    if let Some(page) = fixture(&format!("locale_music_search_{language}")) {
        let summary = parse_summary(&page);
        assert!(
            summary
                .summaries
                .iter()
                .any(|section| section.is_top_result),
            "{language}: top result"
        );
        assert!(!summary.filters.is_empty(), "{language}: offered filters");
        let items: Vec<&YTItem> = summary
            .summaries
            .iter()
            .flat_map(|section| &section.items)
            .collect();
        assert!(
            items.iter().any(|item| matches!(item, YTItem::Episode(_))),
            "{language}: episodes"
        );
        assert!(
            items
                .iter()
                .any(|item| matches!(item, YTItem::Artist(artist) if !artist.is_profile)),
            "{language}: artists"
        );
    }
}

#[test]
fn every_content_language_reads_dates_counts_and_structure() {
    for language in LANGUAGES {
        locale::set_content_language(Some(language));
        check(language);
    }
    locale::set_content_language(None);
}
