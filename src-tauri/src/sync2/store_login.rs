//! Replacing a store's login (spec/protocol.md, Replacing a store's login): what a device has to
//! tell the user, and which devices have read the new one.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::engine::Result;
use super::gc::acks;
use super::roster::{Role, replay_roster};
use super::state::roster_entries;
use super::webdav::WebDavLogin;
use crate::db::settings::{get_setting, set_setting};
use crate::sync::canonical::to_canonical_json;

/// The epoch of the last `remove` applied, until a login at that epoch or later is read.
const LOGIN_DUE: &str = "sync2_login_due";
/// This device's id and the `seq` of the login it last wrote, while that change is under way.
const LOGIN_SENT: &str = "sync2_login_sent";

#[derive(Serialize, Deserialize)]
struct Record {
    k: String,
    n: String,
    w: String,
}

pub(super) fn encode_login(login: &WebDavLogin) -> Vec<u8> {
    to_canonical_json(&Record {
        k: "webdav".to_owned(),
        n: login.user.clone(),
        w: login.password.clone(),
    })
}

pub(super) fn decode_login(content: &[u8]) -> Option<WebDavLogin> {
    let record: Record = serde_json::from_slice(content).ok()?;
    (record.k == "webdav").then_some(WebDavLogin {
        user: record.n,
        password: record.w,
    })
}

async fn due_epoch(pool: &SqlitePool) -> Result<Option<u32>> {
    Ok(get_setting(pool, LOGIN_DUE)
        .await?
        .and_then(|epoch| epoch.parse().ok()))
}

/// A `remove` that starts `epoch` was applied.
pub(super) async fn note_removal(pool: &SqlitePool, epoch: u32) -> Result<()> {
    Ok(set_setting(pool, LOGIN_DUE, &epoch.to_string()).await?)
}

/// A login sealed under `epoch` was read or written.
pub(super) async fn note_login(pool: &SqlitePool, epoch: u32) -> Result<()> {
    if due_epoch(pool).await?.is_some_and(|due| due <= epoch) {
        set_setting(pool, LOGIN_DUE, "").await?;
    }
    Ok(())
}

/// A removed device can still reach the store, as far as this device knows.
pub async fn login_due(pool: &SqlitePool) -> Result<bool> {
    Ok(due_epoch(pool).await?.is_some())
}

pub(super) async fn note_login_sent(pool: &SqlitePool, did: &str, seq: i64) -> Result<()> {
    Ok(set_setting(pool, LOGIN_SENT, &format!("{did} {seq}")).await?)
}

/// This device stops waiting for others to read the login it wrote.
pub async fn forget_login_sent(pool: &SqlitePool) -> Result<()> {
    Ok(set_setting(pool, LOGIN_SENT, "").await?)
}

/// The store's login was replaced, or the group is gone: nothing is left to tell the user.
pub async fn forget_login_change(pool: &SqlitePool) -> Result<()> {
    forget_login_sent(pool).await?;
    Ok(set_setting(pool, LOGIN_DUE, "").await?)
}

/// The current devices that haven't acked the login this device wrote, or `None` when it has no
/// change under way.
pub async fn login_waiting(pool: &SqlitePool) -> Result<Option<Vec<String>>> {
    let Some(sent) = get_setting(pool, LOGIN_SENT).await? else {
        return Ok(None);
    };
    let Some((me, seq)) = sent.split_once(' ') else {
        return Ok(None);
    };
    let seq: u64 = seq.parse().unwrap_or(u64::MAX);
    let acks = acks(pool).await?;
    let state = replay_roster(&roster_entries(pool).await?)?;
    Ok(Some(
        state
            .members
            .iter()
            .filter(|(did, member)| member.role == Role::Device && did.as_str() != me)
            .filter(|(did, _)| {
                acks.get(did.as_str())
                    .and_then(|vv| vv.get(me))
                    .is_none_or(|read| *read < seq)
            })
            .map(|(did, _)| did.clone())
            .collect(),
    ))
}
