//! Which local profile syncs which link (spec/protocol.md, Profiles), and what a run does with
//! each link: the running profile's batches apply now, other linked profiles' are kept.

use std::collections::BTreeSet;

use sqlx::SqlitePool;

use crate::sync::error::SyncError;

/// The links a run reads: the running profile's, and those of linked profiles that aren't running.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Reading {
    pub active: Option<String>,
    pub kept: BTreeSet<String>,
}

impl Reading {
    /// Only `link`, for the running profile; nothing when it is empty (a restored device that
    /// hasn't chosen yet).
    pub fn single(link: &str) -> Self {
        Self {
            active: (!link.is_empty()).then(|| link.to_owned()),
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

/// The links of every linked profile, from the point of view of the running profile. A group
/// joined before profiles chose links has only the link Default joined, which `joined` names.
pub async fn reading(
    pool: &SqlitePool,
    joined: &str,
    running: &str,
    default: &str,
) -> Result<Reading, SyncError> {
    let mut rows: Vec<(String, String)> =
        sqlx::query_as("SELECT profile, link FROM sync2_profile_links")
            .fetch_all(pool)
            .await?;
    if rows.is_empty() && !joined.is_empty() {
        link_profile(pool, default, joined).await?;
        rows.push((default.to_owned(), joined.to_owned()));
    }
    let mut reading = Reading::default();
    for (profile, link) in rows {
        if profile == running {
            reading.active = Some(link);
        } else {
            reading.kept.insert(link);
        }
    }
    Ok(reading)
}
