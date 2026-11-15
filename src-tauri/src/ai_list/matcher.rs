//! Which list a channel is on, after the switches and exemptions. `src/lib/aiList/matcher.ts` is
//! the same rule for the cards; this one answers reports and the `ai_list_match_channels` command.

use std::collections::HashSet;

use serde::Serialize;

use super::formats::{Entries, StoredAiList};
use super::handle;
use super::handle_index::HandleIndex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiVerdict {
    None,
    Warn,
    Block,
}

/// One list side as lookup sets.
#[derive(Debug, Default)]
pub struct AiListSets {
    pub handles: HashSet<String>,
    pub ids: HashSet<String>,
}

impl From<&Entries> for AiListSets {
    fn from(entries: &Entries) -> Self {
        Self {
            handles: entries.handles.iter().cloned().collect(),
            ids: entries.ids.iter().cloned().collect(),
        }
    }
}

impl AiListSets {
    fn is_empty(&self) -> bool {
        self.handles.is_empty() && self.ids.is_empty()
    }
}

/// Both list sides, built once per stored version.
#[derive(Debug, Default)]
pub struct AiLists {
    pub block: AiListSets,
    pub warn: AiListSets,
}

impl From<&StoredAiList> for AiLists {
    fn from(list: &StoredAiList) -> Self {
        Self {
            block: (&list.block).into(),
            warn: (&list.warn).into(),
        }
    }
}

/// What the viewer switched on and chose to see anyway.
#[derive(Debug, Default)]
pub struct MatchRules {
    pub block_enabled: bool,
    pub warn_enabled: bool,
    /// Subscribed and allowed channel ids.
    pub exempt_ids: HashSet<String>,
    /// Allowed channels' normalized handles.
    pub exempt_handles: HashSet<String>,
}

impl MatchRules {
    /// Both lists on and nothing exempt: which list a channel is on, whatever the switches say.
    #[must_use]
    pub fn listing() -> Self {
        Self {
            block_enabled: true,
            warn_enabled: true,
            ..Self::default()
        }
    }
}

const CHANNEL_ID_LENGTH: usize = 24;

/// A `UC…` channel id, not a handle or a music browse id.
#[must_use]
pub fn is_channel_id(id: &str) -> bool {
    id.len() == CHANNEL_ID_LENGTH && id.starts_with("UC")
}

/// A subscribed or allowed channel is never flagged. With hiding off, a block-list channel is still
/// labelled when labels are on: it is the more certain of the two lists. A channel seen with both
/// its id and handle teaches `index`, so it matches later by id alone.
pub fn verdict(
    lists: &AiLists,
    rules: &MatchRules,
    mut index: Option<&mut HandleIndex>,
    channel_id: &str,
    channel_handle: Option<&str>,
) -> AiVerdict {
    let active = (rules.block_enabled || rules.warn_enabled)
        && !(lists.block.is_empty() && lists.warn.is_empty());
    if !active {
        return AiVerdict::None;
    }
    if !channel_id.trim().is_empty() && rules.exempt_ids.contains(channel_id) {
        return AiVerdict::None;
    }
    let id = is_channel_id(channel_id).then_some(channel_id);
    let normalized = channel_handle
        .filter(|h| !h.trim().is_empty())
        .or_else(|| channel_id.starts_with('@').then_some(channel_id))
        .and_then(handle::normalize);
    if let (Some(id), Some(normalized), Some(index)) =
        (id, normalized.as_deref(), index.as_deref_mut())
    {
        index.learn(id, normalized);
    }
    let key = normalized.or_else(|| id.and_then(|id| index?.handle_for(id)));
    if key
        .as_ref()
        .is_some_and(|key| rules.exempt_handles.contains(key))
    {
        return AiVerdict::None;
    }
    let on = |sets: &AiListSets| {
        key.as_ref().is_some_and(|key| sets.handles.contains(key))
            || id.is_some_and(|id| sets.ids.contains(id))
    };
    let on_block = on(&lists.block);
    if on_block && rules.block_enabled {
        return AiVerdict::Block;
    }
    if (on_block || on(&lists.warn)) && rules.warn_enabled {
        AiVerdict::Warn
    } else {
        AiVerdict::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTED_ID: &str = "UCbbbbbbbbbbbbbbbbbbbbbb";
    const OTHER_ID: &str = "UCoooooooooooooooooooooo";

    fn lists() -> AiLists {
        let set = |values: &[&str]| values.iter().map(ToString::to_string).collect();
        AiLists {
            block: AiListSets {
                handles: set(&["drew", "slopmaker"]),
                ids: set(&[LISTED_ID]),
            },
            warn: AiListSets {
                handles: set(&["maybeslop"]),
                ids: HashSet::new(),
            },
        }
    }

    fn rules(block: bool, warn: bool) -> MatchRules {
        MatchRules {
            block_enabled: block,
            warn_enabled: warn,
            ..MatchRules::default()
        }
    }

    fn check(rules: &MatchRules, id: &str, handle: Option<&str>) -> AiVerdict {
        verdict(&lists(), rules, None, id, handle)
    }

    #[test]
    fn a_listed_handle_matches_only_as_a_whole_handle() {
        let on = rules(true, true);
        assert_eq!(check(&on, OTHER_ID, Some("/@Drew")), AiVerdict::Block);
        assert_eq!(check(&on, OTHER_ID, Some("/@drewbinsky")), AiVerdict::None);
    }

    #[test]
    fn a_listed_channel_id_matches_without_a_handle() {
        assert_eq!(check(&rules(true, true), LISTED_ID, None), AiVerdict::Block);
    }

    #[test]
    fn a_handle_given_as_the_channel_id_matches() {
        assert_eq!(
            check(&rules(true, true), "@SlopMaker", None),
            AiVerdict::Block
        );
    }

    #[test]
    fn block_and_warn_lists_stay_apart() {
        let on = rules(true, true);
        assert_eq!(check(&on, OTHER_ID, Some("@SlopMaker")), AiVerdict::Block);
        assert_eq!(check(&on, OTHER_ID, Some("@MaybeSlop")), AiVerdict::Warn);
    }

    #[test]
    fn with_hiding_off_a_block_list_channel_is_still_labelled() {
        assert_eq!(
            check(&rules(false, true), OTHER_ID, Some("@SlopMaker")),
            AiVerdict::Warn
        );
        assert_eq!(
            check(&rules(true, false), OTHER_ID, Some("@MaybeSlop")),
            AiVerdict::None
        );
    }

    #[test]
    fn with_both_switches_off_nothing_is_flagged() {
        assert_eq!(
            check(&rules(false, false), LISTED_ID, None),
            AiVerdict::None
        );
    }

    #[test]
    fn a_subscribed_or_allowed_channel_is_never_flagged() {
        let mut by_id = rules(true, true);
        by_id.exempt_ids.insert(OTHER_ID.to_string());
        assert_eq!(check(&by_id, OTHER_ID, Some("@SlopMaker")), AiVerdict::None);

        let mut by_handle = rules(true, true);
        by_handle.exempt_handles.insert("slopmaker".to_string());
        assert_eq!(
            check(&by_handle, OTHER_ID, Some("@SlopMaker")),
            AiVerdict::None
        );
    }

    #[test]
    fn a_channel_id_seen_once_with_its_handle_matches_later_without_it() {
        let lists = lists();
        let on = rules(true, true);
        let mut index = HandleIndex::default();
        let learned = "UCllllllllllllllllllllll";

        assert_eq!(
            verdict(&lists, &on, Some(&mut index), learned, None),
            AiVerdict::None
        );
        verdict(&lists, &on, Some(&mut index), learned, Some("/@SlopMaker"));
        assert_eq!(
            verdict(&lists, &on, Some(&mut index), learned, None),
            AiVerdict::Block
        );
    }

    #[test]
    fn an_empty_list_flags_nothing() {
        let empty = AiLists::default();
        assert_eq!(
            verdict(&empty, &rules(true, true), None, LISTED_ID, None),
            AiVerdict::None
        );
    }
}
