//! A tab's filter rows: chip bars (with a sort chip that opens a sheet) and
//! the Playlists sort menu. Ported from Flow for Android's `ChannelFilter`.

use serde_json::Value;

use super::about::{first_named, first_token};
use crate::api::innertube::json::text::text_of;
use crate::models::channel::{ChannelFilterGroup, ChannelFilterOption};

#[must_use]
pub(super) fn filters(scope: &Value) -> Vec<ChannelFilterGroup> {
    let mut groups = Vec::new();
    let mut chips = Vec::new();
    for chip in first_named(scope, "chipBarViewModel")
        .and_then(|bar| bar["chips"].as_array())
        .into_iter()
        .flatten()
        .map(|entry| &entry["chipViewModel"])
    {
        let sheet = dropdown_options(chip);
        if !sheet.is_empty() {
            groups.push(ChannelFilterGroup {
                title: None,
                is_dropdown: true,
                options: sheet,
            });
        } else if let Some(label) =
            text_of(&chip["text"]).or_else(|| chip["text"].as_str().map(ToOwned::to_owned))
            && let Some(token) = first_token(&chip["tapCommand"])
        {
            chips.push(ChannelFilterOption {
                label,
                selected: chip["selected"].as_bool().unwrap_or(false),
                continuation: Some(token),
                params: None,
            });
        }
    }
    if !chips.is_empty() {
        groups.push(ChannelFilterGroup {
            title: None,
            is_dropdown: false,
            options: chips,
        });
    }
    if let Some(menu) = first_named(scope, "sortFilterSubMenuRenderer") {
        let options: Vec<ChannelFilterOption> = menu["subMenuItems"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                Some(ChannelFilterOption {
                    label: text_of(&item["title"])
                        .or_else(|| item["title"].as_str().map(ToOwned::to_owned))?,
                    selected: item["selected"].as_bool().unwrap_or(false),
                    continuation: None,
                    params: item["navigationEndpoint"]["browseEndpoint"]["params"]
                        .as_str()
                        .map(ToOwned::to_owned),
                })
            })
            .collect();
        if !options.is_empty() {
            groups.push(ChannelFilterGroup {
                title: text_of(&menu["title"]),
                is_dropdown: true,
                options,
            });
        }
    }
    groups
}

/// A sort chip's options live in the sheet it opens, not on the chip.
fn dropdown_options(chip: &Value) -> Vec<ChannelFilterOption> {
    chip["tapCommand"]["innertubeCommand"]["showSheetCommand"]["panelLoadingStrategy"]["inlineContent"]
        ["sheetViewModel"]["content"]["listViewModel"]["listItems"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let item = &entry["listItemViewModel"];
            Some(ChannelFilterOption {
                label: text_of(&item["title"])?,
                selected: item["isSelected"].as_bool().unwrap_or(false),
                continuation: first_token(&item["rendererContext"]),
                params: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_sort_sheet_and_plain_chips_become_two_rows() {
        let scope = json!({ "header": { "chipBarViewModel": { "chips": [
            { "chipViewModel": { "text": "Latest", "tapCommand": { "innertubeCommand": { "showSheetCommand": {
                "panelLoadingStrategy": { "inlineContent": { "sheetViewModel": { "content": { "listViewModel": { "listItems": [
                    { "listItemViewModel": { "title": { "content": "Latest" }, "isSelected": true,
                        "rendererContext": { "commandContext": { "onTap": { "innertubeCommand": { "continuationCommand": { "token": "LATEST" } } } } } } },
                    { "listItemViewModel": { "title": { "content": "Popular" },
                        "rendererContext": { "commandContext": { "onTap": { "innertubeCommand": { "continuationCommand": { "token": "POPULAR" } } } } } } }
                ] } } } } }
            } } } } },
            { "chipViewModel": { "text": "Members only", "tapCommand": { "innertubeCommand": { "continuationCommand": { "token": "MEMBERS" } } } } }
        ] } } });
        let groups = filters(&scope);
        assert_eq!(groups.len(), 2);
        assert!(groups[0].is_dropdown);
        assert_eq!(
            groups[0].options[1].continuation.as_deref(),
            Some("POPULAR")
        );
        assert!(groups[0].options[0].selected);
        assert_eq!(groups[1].options[0].label, "Members only");
    }

    #[test]
    fn the_playlists_sort_menu_re_browses_with_params() {
        let scope = json!({ "subMenu": { "channelSubMenuRenderer": { "sortSetting": { "sortFilterSubMenuRenderer": {
            "title": "Sort by",
            "subMenuItems": [{ "title": "Date added (newest)", "selected": true,
                "navigationEndpoint": { "browseEndpoint": { "params": "NEWEST" } } }]
        } } } } });
        let groups = filters(&scope);
        assert_eq!(groups[0].title.as_deref(), Some("Sort by"));
        assert_eq!(groups[0].options[0].params.as_deref(), Some("NEWEST"));
    }
}
