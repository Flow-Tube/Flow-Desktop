//! A channel's tabs, from the response that lists them.

use serde_json::Value;

use crate::api::innertube::json::text::text_of;
use crate::models::channel::ChannelTab;

/// Every tab renderer of a browse response, plain or expandable (Search).
pub(super) fn tab_renderers(page: &Value) -> Vec<&Value> {
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

/// The tab a response shows: the one marked selected, else the first with content.
pub(super) fn selected_content(page: &Value) -> Option<&Value> {
    let tabs = tab_renderers(page);
    tabs.iter()
        .find(|tab| tab["selected"].as_bool() == Some(true) && tab.get("content").is_some())
        .or_else(|| tabs.iter().find(|tab| tab.get("content").is_some()))
        .map(|tab| &tab["content"])
}

/// The tab's kind from its own URL's last segment, never its title: titles
/// arrive localised.
pub(super) fn kind_of(url: &str) -> &'static str {
    let segment = url
        .split('?')
        .next()
        .unwrap_or_default()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if segment.starts_with('@') || segment.starts_with("uc") {
        return "home";
    }
    match segment.as_str() {
        "featured" | "home" => "home",
        "videos" => "videos",
        "shorts" => "shorts",
        "streams" | "live" => "live",
        "shows" => "shows",
        "podcasts" => "podcasts",
        "playlists" => "playlists",
        "courses" => "courses",
        "community" | "posts" => "posts",
        "releases" => "releases",
        "store" => "store",
        "search" => "search",
        _ => "unknown",
    }
}

#[must_use]
pub(super) fn tabs(page: &Value) -> Vec<ChannelTab> {
    tab_renderers(page)
        .into_iter()
        .enumerate()
        .filter_map(|(index, tab)| {
            let endpoint = &tab["endpoint"];
            let url = endpoint["commandMetadata"]["webCommandMetadata"]["url"]
                .as_str()
                .unwrap_or_default();
            let mut kind = kind_of(url);
            // The landing tab is first, and is sometimes sent without a URL.
            if kind == "unknown" && index == 0 {
                kind = "home";
            }
            let title = text_of(&tab["title"])
                .map(|title| title.trim().to_string())
                .unwrap_or_default();
            if title.is_empty() && kind == "unknown" {
                return None;
            }
            Some(ChannelTab {
                kind: kind.to_string(),
                title,
                params: endpoint["browseEndpoint"]["params"]
                    .as_str()
                    .map(ToOwned::to_owned),
                selected: tab["selected"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tab_kind_comes_from_its_url() {
        assert_eq!(kind_of("/@LinusTechTips/streams"), "live");
        assert_eq!(kind_of("/channel/UCabc/community?x=1"), "posts");
        assert_eq!(kind_of("/@LinusTechTips"), "home");
        assert_eq!(kind_of("/@x/releases/"), "releases");
        assert_eq!(kind_of("/@x/merch"), "unknown");
    }
}
