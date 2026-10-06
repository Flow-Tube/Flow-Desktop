//! Turning the recorded edits in `sync_changes` into wire records: tombstones for what was deleted
//! and edit stamps for what changed. A tombstone received from a peer is relayed exactly as
//! received; one made on this device is stamped with the time the user deleted it.

use std::collections::{BTreeMap, BTreeSet};

use serde::de::DeserializeOwned;

use crate::sync::canonical::{
    Hlc, Like, LikeKind, LikeState, Playlist, PlaylistItem, SubscriptionGroup, WatchHistoryRecord,
};
use crate::sync::changes::{self, Stamp};
use crate::sync::merge::playlist_merge_key;

fn peer_record<T: DeserializeOwned>(stamp: &Stamp) -> Option<T> {
    stamp
        .from_peer
        .then(|| serde_json::from_str(stamp.record.as_deref()?).ok())
        .flatten()
}

fn deletions<'a>(
    stamps: &'a BTreeMap<String, Stamp>,
    live: &'a BTreeSet<String>,
) -> impl Iterator<Item = (&'a String, &'a Stamp)> {
    stamps
        .iter()
        .filter(move |(k, s)| s.deleted && !live.contains(*k))
}

#[must_use]
pub fn watch_history(
    stamps: &BTreeMap<String, Stamp>,
    live: &BTreeSet<String>,
    device_id: &str,
) -> Vec<WatchHistoryRecord> {
    deletions(stamps, live)
        .map(|(key, s)| {
            peer_record(s).unwrap_or_else(|| WatchHistoryRecord {
                video_id: key.clone(),
                hlc: Hlc::new(s.at_ms, 0, device_id),
                deleted: true,
                ..WatchHistoryRecord::default()
            })
        })
        .collect()
}

#[must_use]
pub fn likes(
    stamps: &BTreeMap<String, Stamp>,
    live: &BTreeSet<String>,
    device_id: &str,
) -> Vec<Like> {
    deletions(stamps, live)
        .filter_map(|(key, s)| {
            peer_record(s).or_else(|| {
                let (kind, id) = key.split_once(':')?;
                let kind = match kind {
                    "music" => LikeKind::Music,
                    "video" => LikeKind::Video,
                    _ => return None,
                };
                Some(Like {
                    kind,
                    id: id.to_string(),
                    state: LikeState::None,
                    updated_at_ms: s.at_ms,
                    hlc: Hlc::new(s.at_ms, 0, device_id),
                    meta: None,
                })
            })
        })
        .collect()
}

#[must_use]
pub fn groups(
    stamps: &BTreeMap<String, Stamp>,
    live: &BTreeSet<String>,
    device_id: &str,
) -> Vec<SubscriptionGroup> {
    deletions(stamps, live)
        .map(|(key, s)| {
            peer_record(s).unwrap_or_else(|| SubscriptionGroup {
                name: key.clone(),
                deleted: true,
                hlc: Hlc::new(s.at_ms, 0, device_id),
                ..SubscriptionGroup::default()
            })
        })
        .collect()
}

/// Stamp each group with when it last changed here. A group with no recorded edit predates this
/// tracking and gets the oldest stamp, so any real edit or deletion from a peer wins over it.
pub fn stamp_groups(
    groups: &mut [SubscriptionGroup],
    stamps: &BTreeMap<String, Stamp>,
    device_id: &str,
) {
    for g in groups {
        let at = stamps.get(&g.name).map_or(0, |s| s.at_ms);
        g.hlc = Hlc::new(at, 0, device_id);
    }
}

/// Apply edit stamps to live playlists and their tracks, add track tombstones inside them, and
/// append tombstones for deleted playlists.
pub fn playlists(
    live: &mut Vec<Playlist>,
    playlist_stamps: &BTreeMap<String, Stamp>,
    item_stamps: &BTreeMap<String, Stamp>,
    device_id: &str,
) {
    for p in live.iter_mut() {
        if let Some(s) = playlist_stamps.get(&p.sync_id)
            && s.at_ms > p.updated_hlc.physical_ms
        {
            p.updated_hlc = Hlc::new(s.at_ms, 0, device_id);
        }
        let present: BTreeSet<String> = p.items.iter().map(|i| i.video_id.clone()).collect();
        for item in &mut p.items {
            if let Some(s) = item_stamps.get(&changes::item_key(&p.sync_id, &item.video_id))
                && s.at_ms > item.hlc.physical_ms
            {
                item.hlc = Hlc::new(s.at_ms, 0, device_id);
            }
        }
        let prefix = format!("{}|", p.sync_id);
        for (key, s) in item_stamps.range(prefix.clone()..) {
            let Some(video_id) = key.strip_prefix(&prefix) else {
                break;
            };
            if !s.deleted || present.contains(video_id) {
                continue;
            }
            p.items.push(peer_record(s).unwrap_or_else(|| PlaylistItem {
                video_id: video_id.to_string(),
                deleted: true,
                hlc: Hlc::new(s.at_ms, 0, device_id),
                ..PlaylistItem::default()
            }));
        }
    }

    let live_ids: BTreeSet<String> = live.iter().map(|p| p.sync_id.clone()).collect();
    let live_keys: BTreeSet<String> = live.iter().map(playlist_merge_key).collect();
    for (key, s) in deletions(playlist_stamps, &live_ids) {
        let tombstone = peer_record(s).unwrap_or_else(|| {
            let template: Option<Playlist> = s
                .record
                .as_deref()
                .and_then(|r| serde_json::from_str(r).ok());
            Playlist {
                sync_id: key.clone(),
                updated_hlc: Hlc::new(s.at_ms, 0, device_id),
                deleted: true,
                items: Vec::new(),
                ..template.unwrap_or_default()
            }
        });
        if !live_keys.contains(&playlist_merge_key(&tombstone)) {
            live.push(tombstone);
        }
    }
}
