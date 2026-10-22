//! Names for hidden channels, from Flow for Android's `BlockedChannelNames` (#1325): a block saves
//! the name it was made with; older blocks and ones that arrived by sync are named from what the
//! device already holds, and each channel's RSS feed is asked once a session for the rest.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;

use sqlx::SqlitePool;

use crate::api::http::{bounded_join, shared_client};
use crate::db::settings::{get_setting, set_setting};
use crate::errors::AppResult;
use crate::services::subscription_feed::rss::{fetch_rss, parse_rss_feed};

/// Device-local: not in the settings sync allowlist.
const STORE_KEY: &str = "blocked_channel_names";
const PARALLEL_FETCHES: usize = 4;
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct BlockedChannelNames {
    /// Channels the network could not name this session; not asked again until the next one.
    unnamed: Mutex<HashSet<String>>,
    resolving: tokio::sync::Mutex<()>,
}

/// The names saved when channels were blocked or looked up.
pub async fn stored(pool: &SqlitePool) -> HashMap<String, String> {
    get_setting(pool, STORE_KEY)
        .await
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

async fn save(pool: &SqlitePool, names: &HashMap<String, String>) -> AppResult<()> {
    set_setting(
        pool,
        STORE_KEY,
        &serde_json::to_string(names).unwrap_or_default(),
    )
    .await
}

/// Keeps the name a channel was blocked with.
pub async fn remember(pool: &SqlitePool, channel_id: &str, name: &str) -> AppResult<()> {
    let name = name.trim();
    if channel_id.is_empty() || name.is_empty() {
        return Ok(());
    }
    let mut names = stored(pool).await;
    names.insert(channel_id.to_string(), name.to_string());
    save(pool, &names).await
}

pub async fn forget(pool: &SqlitePool, channel_id: &str) -> AppResult<()> {
    let mut names = stored(pool).await;
    if names.remove(channel_id).is_some() {
        save(pool, &names).await?;
    }
    Ok(())
}

async fn rss_name(channel_id: String) -> String {
    let fetched = tokio::time::timeout(FETCH_TIMEOUT, fetch_rss(shared_client(), &channel_id))
        .await
        .ok()
        .and_then(Result::ok);
    fetched
        .and_then(|xml| parse_rss_feed(&channel_id, &xml).0)
        .map(|name| name.trim().to_string())
        .unwrap_or_default()
}

/// Asks `fetch` for each of `ids`, `parallel` at a time, and hands each round's names and the ids it
/// could not name to `on_round`. A round that names nothing looks like no connection rather than
/// gone channels, so it ends the pass unreported and leaves the rest for another time.
async fn names_in_rounds<F, Fut>(
    ids: Vec<String>,
    parallel: usize,
    fetch: F,
    mut on_round: impl FnMut(HashMap<String, String>, Vec<String>),
) where
    F: Fn(String) -> Fut + Copy,
    Fut: Future<Output = String>,
{
    for round in ids.chunks(parallel.max(1)) {
        let answers = bounded_join(round.to_vec(), parallel, |id| async move {
            let name = fetch(id.clone()).await;
            (id, name)
        })
        .await;
        let (named, failed): (Vec<_>, Vec<_>) =
            answers.into_iter().partition(|(_, name)| !name.is_empty());
        if named.is_empty() {
            return;
        }
        on_round(
            named.into_iter().collect(),
            failed.into_iter().map(|(id, _)| id).collect(),
        );
    }
}

impl BlockedChannelNames {
    /// Looks up the names of `missing` channels on their RSS feeds and saves those still blocked.
    /// One pass runs at a time; a second call meanwhile returns nothing.
    pub async fn resolve(
        &self,
        pool: &SqlitePool,
        missing: Vec<String>,
        blocked: &HashSet<String>,
    ) -> HashMap<String, String> {
        let Ok(_pass) = self.resolving.try_lock() else {
            return HashMap::new();
        };
        let mut seen = HashSet::new();
        let ids: Vec<String> = {
            let unnamed = self.unnamed.lock().unwrap();
            missing
                .into_iter()
                .filter(|id| !unnamed.contains(id) && seen.insert(id.clone()))
                .collect()
        };
        let mut found = HashMap::new();
        names_in_rounds(ids, PARALLEL_FETCHES, rss_name, |names, failed| {
            self.unnamed.lock().unwrap().extend(failed);
            found.extend(names);
        })
        .await;
        if !found.is_empty() {
            let mut names = stored(pool).await;
            names.extend(
                found
                    .iter()
                    .filter(|(id, _)| blocked.contains(*id))
                    .map(|(id, name)| (id.clone(), name.clone())),
            );
            if let Err(error) = save(pool, &names).await {
                tracing::warn!(%error, "[taste] saving looked-up channel names failed");
            }
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_round_that_names_nothing_ends_the_pass() {
        let ids: Vec<String> = ["a", "b", "c", "d", "e"].map(String::from).to_vec();
        let mut rounds = Vec::new();
        names_in_rounds(
            ids,
            2,
            |id| async move {
                match id.as_str() {
                    "a" => "Alpha".to_string(),
                    _ => String::new(),
                }
            },
            |names, failed| rounds.push((names, failed)),
        )
        .await;
        assert_eq!(
            rounds.len(),
            1,
            "the round of c and d named nothing, so e is never asked"
        );
        assert_eq!(rounds[0].0.get("a").map(String::as_str), Some("Alpha"));
        assert_eq!(rounds[0].1, ["b"]);
    }

    #[test]
    fn the_feed_names_its_channel() {
        let xml = "<feed><author><name>Chess Dropout</name></author><entry><yt:videoId>x</yt:videoId></entry></feed>";
        assert_eq!(
            parse_rss_feed("UC1", xml).0.as_deref(),
            Some("Chess Dropout")
        );
    }
}
