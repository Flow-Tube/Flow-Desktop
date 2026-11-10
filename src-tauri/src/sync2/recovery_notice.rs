//! Telling the user the recovery key changed (spec/protocol.md, Recovery): the words they hold may
//! have just stopped working. The notice stays until answered.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::engine::{Result, now_ms};
use super::roster::{Entry, Op, entry_hash};
use crate::db::settings::{get_setting, set_setting};

const NOTICE: &str = "sync2_recovery_notice";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryNotice {
    /// The device behind the change; for a restore, the device it added.
    pub device: String,
    /// When this device learned of it.
    pub at_ms: i64,
}

fn changed_by(entry: &Entry) -> Option<&str> {
    match entry.op {
        Op::Restore => entry.add.iter().flatten().next().map(|s| s.did.as_str()),
        Op::Recovery => Some(&entry.signer),
        Op::Remove if entry.add.is_some() => Some(&entry.signer),
        _ => None,
    }
}

/// Keeps a notice of the latest such entry in `chain` that `applied` didn't have, unless this
/// device did it. A device with nothing applied is only catching up.
pub(super) async fn note_recovery_changes(
    pool: &SqlitePool,
    me: &str,
    applied: &[Entry],
    chain: &[Entry],
) -> Result<()> {
    if applied.is_empty() {
        return Ok(());
    }
    let known: BTreeSet<String> = applied.iter().map(entry_hash).collect();
    let latest = chain
        .iter()
        .filter(|entry| !known.contains(&entry_hash(entry)))
        .filter_map(changed_by)
        .next_back();
    let Some(device) = latest.filter(|device| *device != me) else {
        return Ok(());
    };
    let notice = RecoveryNotice {
        device: device.to_owned(),
        at_ms: now_ms(),
    };
    let text = serde_json::to_string(&notice).map_err(|_| super::Error::Payload)?;
    Ok(set_setting(pool, NOTICE, &text).await?)
}

pub async fn recovery_notice(pool: &SqlitePool) -> Result<Option<RecoveryNotice>> {
    let text = get_setting(pool, NOTICE).await?;
    Ok(text.and_then(|text| serde_json::from_str(&text).ok()))
}

pub async fn forget_recovery_notice(pool: &SqlitePool) -> Result<()> {
    Ok(set_setting(pool, NOTICE, "").await?)
}
