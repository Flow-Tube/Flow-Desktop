//! Which local profile syncs which link (spec/protocol.md, Profiles), and what a run does with
//! each link: the running profile's batches apply now, other linked profiles' are kept.

use std::collections::BTreeSet;

use sqlx::SqlitePool;

use super::kept::has_kept;
use super::state::links_to_read;
use crate::sync::error::SyncError;

/// The links a run reads: the running profile's, and those of linked profiles that aren't running.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Reading {
    pub active: Option<String>,
    pub kept: BTreeSet<String>,
    /// The link a new device's Default joins: Default's here, else the first one synced.
    pub welcome: Option<String>,
}

impl Reading {
    /// Only `link`, for the running profile; nothing when it is empty (a restored device that
    /// hasn't chosen yet).
    pub fn single(link: &str) -> Self {
        let active = (!link.is_empty()).then(|| link.to_owned());
        Self {
            welcome: active.clone(),
            active,
            kept: BTreeSet::new(),
        }
    }

    pub fn links(&self) -> impl Iterator<Item = &str> {
        self.active.iter().chain(&self.kept).map(String::as_str)
    }

    pub fn reads(&self, link: &str) -> bool {
        self.active.as_deref() == Some(link) || self.kept.contains(link)
    }
}

/// Whether `link` still waits here on data other devices sent: kept batches, or its snapshot.
pub async fn catching_up(pool: &SqlitePool, link: &str) -> Result<bool, SyncError> {
    Ok(has_kept(pool, link).await? || links_to_read(pool).await?.iter().any(|l| l == link))
}

/// Links `profile` to `link`.
pub async fn link_profile(pool: &SqlitePool, profile: &str, link: &str) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO sync2_profile_links (profile, link) VALUES (?, ?)
         ON CONFLICT (profile) DO UPDATE SET link = excluded.link",
    )
    .bind(profile)
    .bind(link)
    .execute(pool)
    .await?;
    Ok(())
}

/// Stops syncing `profile` here: its link's kept batches and pending read go too.
pub async fn unlink(pool: &SqlitePool, profile: &str) -> Result<(), SyncError> {
    let link: Option<String> =
        sqlx::query_scalar("SELECT link FROM sync2_profile_links WHERE profile = ?")
            .bind(profile)
            .fetch_optional(pool)
            .await?;
    match link {
        Some(link) => forget_link(pool, &link).await,
        None => Ok(()),
    }
}

/// Stops syncing `link` here, whichever profile synced it.
pub async fn forget_link(pool: &SqlitePool, link: &str) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for statement in [
        "DELETE FROM sync2_profile_links WHERE link = ?",
        "DELETE FROM sync2_kept WHERE link = ?",
        "DELETE FROM sync2_reading WHERE link = ?",
    ] {
        sqlx::query(statement).bind(link).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Each linked profile and its link.
pub async fn linked(pool: &SqlitePool) -> Result<Vec<(String, String)>, SyncError> {
    Ok(
        sqlx::query_as("SELECT profile, link FROM sync2_profile_links ORDER BY profile")
            .fetch_all(pool)
            .await?,
    )
}

/// The links of every linked profile, from the point of view of the running profile. A group
/// joined before profiles chose links has only the link Default joined, which `joined` names.
pub async fn reading(
    pool: &SqlitePool,
    joined: &str,
    running: &str,
    default: &str,
) -> Result<Reading, SyncError> {
    let mut rows = linked(pool).await?;
    if rows.is_empty() && !joined.is_empty() {
        link_profile(pool, default, joined).await?;
        rows.push((default.to_owned(), joined.to_owned()));
    }
    let mut reading = Reading {
        welcome: rows
            .iter()
            .find(|(profile, _)| profile == default)
            .or(rows.first())
            .map(|(_, link)| link.clone()),
        ..Reading::default()
    };
    for (profile, link) in rows {
        if profile == running {
            reading.active = Some(link);
        } else {
            reading.kept.insert(link);
        }
    }
    Ok(reading)
}
