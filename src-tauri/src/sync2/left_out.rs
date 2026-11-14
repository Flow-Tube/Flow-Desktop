//! Collections this device leaves out of its links (spec/protocol.md, Leaving collections out).
//! The choice is the device's own: it is kept in Default's file, never written to the store, and
//! the same whichever profile runs. A collection left out is neither sent nor applied, and no
//! snapshot is written while anything is left out. One taken back is read again from the link's
//! newest snapshot before this device sends its own changes to it.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::batches::IncomingBatch;
use crate::db::settings::{get_setting, set_setting};
use crate::sync::canonical::Collection;
use crate::sync::error::SyncError;

const LEFT_OUT_KEY: &str = "sync2_left_out";
const TAKEN_BACK_KEY: &str = "sync2_taken_back";

/// What the user chooses to sync, each standing for one or more collections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncChoice {
    WatchHistory,
    Playlists,
    Likes,
    /// Subscribed channels and their groups.
    Subscriptions,
    Notes,
    /// Both recommendation engines.
    Recommendations,
    Settings,
}

impl SyncChoice {
    #[must_use]
    pub fn collections(self) -> &'static [Collection] {
        match self {
            Self::WatchHistory => &[Collection::WatchHistory],
            Self::Playlists => &[Collection::Playlists],
            Self::Likes => &[Collection::Likes],
            Self::Subscriptions => &[Collection::SubscribedChannels, Collection::Subscriptions],
            Self::Notes => &[Collection::Notes],
            Self::Recommendations => &[Collection::FlowNeuroBrain, Collection::MusicBrain],
            Self::Settings => &[Collection::Settings],
        }
    }
}

/// The collections `choices` stand for.
#[must_use]
pub fn collections_of(choices: &BTreeSet<SyncChoice>) -> Vec<Collection> {
    choices
        .iter()
        .flat_map(|choice| choice.collections().iter().copied())
        .collect()
}

/// The collections this device sends, of every one there is.
#[must_use]
pub fn sent_collections(held_back: &[Collection]) -> Vec<Collection> {
    Collection::ALL
        .into_iter()
        .filter(|collection| !held_back.contains(collection))
        .collect()
}

/// Whether a batch read is applied: one of a collection left out is dropped. A batch this build
/// can't name a collection for is left to the apply step, as before.
#[must_use]
pub fn applies(batch: &IncomingBatch, left_out: &[Collection]) -> bool {
    batch
        .collection
        .is_none_or(|collection| !left_out.contains(&collection))
}

async fn read(pool: &SqlitePool, key: &str) -> Result<BTreeSet<SyncChoice>, SyncError> {
    let raw = get_setting(pool, key)
        .await
        .map_err(|e| SyncError::Db(e.to_string()))?;
    Ok(raw
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default())
}

async fn write(
    pool: &SqlitePool,
    key: &str,
    choices: &BTreeSet<SyncChoice>,
) -> Result<(), SyncError> {
    let raw = serde_json::to_string(choices)?;
    set_setting(pool, key, &raw)
        .await
        .map_err(|e| SyncError::Db(e.to_string()))
}

/// What this device leaves out of its links.
pub async fn left_out(pool: &SqlitePool) -> Result<BTreeSet<SyncChoice>, SyncError> {
    read(pool, LEFT_OUT_KEY).await
}

/// What was taken back and is still to be read again.
pub async fn taken_back(pool: &SqlitePool) -> Result<BTreeSet<SyncChoice>, SyncError> {
    read(pool, TAKEN_BACK_KEY).await
}

/// Leaves `choices` out. What is no longer left out is read again; what is left out again before
/// that no longer needs to be. Says whether anything was taken back.
pub async fn set_left_out(
    pool: &SqlitePool,
    choices: &BTreeSet<SyncChoice>,
) -> Result<bool, SyncError> {
    let before = left_out(pool).await?;
    let mut back = taken_back(pool).await?;
    back.extend(before.difference(choices).copied());
    back.retain(|choice| !choices.contains(choice));
    write(pool, TAKEN_BACK_KEY, &back).await?;
    write(pool, LEFT_OUT_KEY, choices).await?;
    Ok(!back.is_empty())
}

/// `choices` were read again.
pub async fn read_back(pool: &SqlitePool, choices: &BTreeSet<SyncChoice>) -> Result<(), SyncError> {
    let mut back = taken_back(pool).await?;
    back.retain(|choice| !choices.contains(choice));
    write(pool, TAKEN_BACK_KEY, &back).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn memory() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn set(choices: &[SyncChoice]) -> BTreeSet<SyncChoice> {
        choices.iter().copied().collect()
    }

    #[test]
    fn each_collection_but_profiles_belongs_to_one_choice() {
        let all: Vec<Collection> = collections_of(&set(&[
            SyncChoice::WatchHistory,
            SyncChoice::Playlists,
            SyncChoice::Likes,
            SyncChoice::Subscriptions,
            SyncChoice::Notes,
            SyncChoice::Recommendations,
            SyncChoice::Settings,
        ]));
        assert_eq!(all.len(), Collection::ALL.len());
        for collection in Collection::ALL {
            assert_eq!(
                all.iter().filter(|c| **c == collection).count(),
                1,
                "{collection:?}"
            );
        }
    }

    #[test]
    fn subscriptions_bring_their_groups_and_recommendations_both_brains() {
        assert_eq!(
            collections_of(&set(&[
                SyncChoice::Subscriptions,
                SyncChoice::Recommendations
            ])),
            vec![
                Collection::SubscribedChannels,
                Collection::Subscriptions,
                Collection::FlowNeuroBrain,
                Collection::MusicBrain,
            ]
        );
    }

    #[test]
    fn sends_everything_but_what_is_held_back() {
        assert_eq!(sent_collections(&[]), Collection::ALL.to_vec());
        let sent = sent_collections(&[Collection::Likes, Collection::Notes]);
        assert!(!sent.contains(&Collection::Likes) && !sent.contains(&Collection::Notes));
        assert_eq!(sent.len(), Collection::ALL.len() - 2);
    }

    #[test]
    fn drops_only_batches_of_a_collection_left_out() {
        let batch =
            |collection| IncomingBatch::kept(collection, "l".into(), "h".into(), Vec::new());
        let left_out = [Collection::WatchHistory];
        assert!(!applies(&batch("watch_history"), &left_out));
        assert!(applies(&batch("likes"), &left_out));
        assert!(applies(&batch("not_a_collection"), &left_out));
        assert!(applies(&batch("watch_history"), &[]));
    }

    #[test]
    fn choices_read_back_in_the_wire_form() {
        assert_eq!(
            serde_json::to_string(&set(&[
                SyncChoice::WatchHistory,
                SyncChoice::Recommendations
            ]))
            .unwrap(),
            r#"["watchHistory","recommendations"]"#
        );
    }

    #[tokio::test]
    async fn taking_back_reads_again_until_read() {
        let pool = memory().await;
        assert!(left_out(&pool).await.unwrap().is_empty());
        let out = set(&[SyncChoice::Likes, SyncChoice::Notes]);
        assert!(!set_left_out(&pool, &out).await.unwrap());
        assert_eq!(left_out(&pool).await.unwrap(), out);

        assert!(
            set_left_out(&pool, &set(&[SyncChoice::Notes]))
                .await
                .unwrap()
        );
        assert_eq!(taken_back(&pool).await.unwrap(), set(&[SyncChoice::Likes]));

        read_back(&pool, &set(&[SyncChoice::Likes])).await.unwrap();
        assert!(taken_back(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn leaving_out_again_before_the_read_needs_none() {
        let pool = memory().await;
        set_left_out(&pool, &set(&[SyncChoice::Likes]))
            .await
            .unwrap();
        set_left_out(&pool, &set(&[])).await.unwrap();
        assert_eq!(taken_back(&pool).await.unwrap(), set(&[SyncChoice::Likes]));
        assert!(
            !set_left_out(&pool, &set(&[SyncChoice::Likes]))
                .await
                .unwrap()
        );
        assert!(taken_back(&pool).await.unwrap().is_empty());
    }
}
