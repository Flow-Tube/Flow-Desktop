//! The `notes` collection: reading the table as wire records with their tombstones, and folding a
//! received payload into it.

use std::collections::{BTreeMap, BTreeSet};

use sqlx::{Sqlite, SqliteConnection, Transaction};

use crate::db::notes as table;
use crate::sync::apply::ApplyStats;
use crate::sync::canonical::{Collection, Note};
use crate::sync::changes;
use crate::sync::clock;
use crate::sync::error::SyncError;
use crate::sync::merge;
use crate::sync::tombstones;

fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0)
}

/// This device's notes and the deletions it still announces, sorted by `id`.
pub async fn local_notes(conn: &mut SqliteConnection) -> Result<Vec<Note>, SyncError> {
    let mut records: Vec<Note> = table::all_on(&mut *conn)
        .await?
        .iter()
        .map(table::NoteRow::to_canonical)
        .collect();
    let live: BTreeSet<String> = records.iter().map(|n| n.id.clone()).collect();
    let stamps = changes::load(conn, changes::NOTES, now_ms()).await?;
    records.extend(tombstones::notes(&stamps, &live));
    records.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(records)
}

pub(super) async fn apply_notes(
    tx: &mut Transaction<'_, Sqlite>,
    incoming: Vec<Note>,
) -> Result<ApplyStats, SyncError> {
    let newest = incoming.iter().map(|n| n.updated_at).max().unwrap_or(0);
    clock::observe(tx, u64::try_from(newest).unwrap_or(0)).await?;

    let local = local_notes(tx).await?;
    let before: BTreeMap<String, Note> = local.iter().map(|n| (n.id.clone(), n.clone())).collect();
    let mut stat = ApplyStats {
        collection_key: Collection::Notes.key().to_string(),
        ..Default::default()
    };
    for note in merge::merge_notes(local, incoming) {
        let previous = before.get(&note.id);
        if previous == Some(&note) {
            stat.skipped += 1;
            continue;
        }
        let had_row = previous.is_some_and(|p| !p.deleted);
        if note.deleted {
            // Kept even for a note this device never had, to reach devices that never heard of it.
            let at = u64::try_from(note.updated_at).unwrap_or(0);
            let record = serde_json::to_string(&note)?;
            changes::record_peer_tombstone(tx, changes::NOTES, &note.id, at, record).await?;
            if had_row {
                table::delete(tx, &note.id).await?;
                stat.tombstoned += 1;
            } else {
                stat.skipped += 1;
            }
        } else if note.text.trim().is_empty() {
            // Blank is never a note; Android doesn't write one either.
            stat.skipped += 1;
        } else {
            table::upsert_merged(tx, &note).await?;
            if had_row {
                stat.updated += 1;
            } else {
                stat.added += 1;
            }
        }
    }
    Ok(stat)
}
