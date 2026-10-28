//! Stored uploads that run like a Short but were never called one get their kind read from their
//! player response. The store keeps rows written before RSS told Shorts apart, and an upload whose
//! RSS feed has moved past it is never classified again, so these are asked about one by one.

use std::collections::HashSet;

use sqlx::SqlitePool;

use super::cache;
use super::card::Card;
use crate::services::youtube_service::YoutubeService;

/// Only recent uploads are asked about; older ones have aged out of Home's subscription lane.
const WINDOW_MS: u64 = 14 * 86_400_000;
/// Shorts run up to three minutes; one this short was already called a Short by its length.
const SHORT_LIKE_SECONDS: std::ops::RangeInclusive<u64> = 61..=180;
const CHECKS_PER_LOAD: usize = 40;
const CHECK_CONCURRENCY: usize = 3;

/// Reads the kind of up to forty stored uploads not checked yet, newest first. A Short found joins
/// the known Shorts.
pub async fn check_stored_uploads(yt: &YoutubeService, pool: &SqlitePool, now_ms: u64) {
    let Ok(store) = cache::subscription_uploads(pool).await else {
        return;
    };
    let known = crate::db::known_shorts::all(pool).await.unwrap_or_default();
    let candidates = short_like(&store, &known, now_ms);
    if candidates.is_empty() {
        return;
    }
    let Ok(checked) = crate::db::video_kind_checks::checked_among(pool, &candidates).await else {
        return;
    };
    let ids: Vec<String> = candidates
        .into_iter()
        .filter(|id| !checked.contains(id))
        .take(CHECKS_PER_LOAD)
        .collect();
    if ids.is_empty() {
        return;
    }
    let kinds: Vec<(String, bool)> =
        crate::api::http::bounded_join(ids, CHECK_CONCURRENCY, |id| async move {
            match yt.get_video_basics(&id).await {
                Ok(basics) => Some((id, basics.is_short.unwrap_or(false))),
                // A video that will never play is not asked about again either.
                Err(error) if error.is_lasting_refusal() => Some((id, false)),
                Err(_) => None,
            }
        })
        .await
        .into_iter()
        .flatten()
        .collect();
    tracing::info!(
        checked = kinds.len(),
        shorts = kinds.iter().filter(|(_, is_short)| *is_short).count(),
        "Stored uploads checked for Shorts"
    );
    let _ = crate::db::video_kind_checks::record(
        pool,
        &kinds,
        i64::try_from(now_ms).unwrap_or(i64::MAX),
    )
    .await;
}

/// Ids of recent stored uploads with a Short's length that nothing has called a Short, newest first.
fn short_like(store: &[Card], known: &HashSet<String>, now_ms: u64) -> Vec<String> {
    let mut cards: Vec<&Card> = store
        .iter()
        .filter(|c| !c.video.is_short && !c.video.is_live && !known.contains(c.id()))
        .filter(|c| {
            c.video
                .duration_seconds
                .is_some_and(|seconds| SHORT_LIKE_SECONDS.contains(&seconds))
        })
        .filter(|c| c.age_ms(now_ms).is_some_and(|age| age <= WINDOW_MS))
        .collect();
    cards.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
    cards.into_iter().map(|c| c.id().to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::home_feed::filters::tests::card;

    #[test]
    fn only_recent_unflagged_uploads_of_a_short_length_are_asked_about() {
        let now = 30 * 86_400_000;
        let upload = |id: &str, seconds: u64, age_days: u64| {
            let mut card = card(id, "UC1", "");
            card.video.duration_seconds = Some(seconds);
            card.published_at_ms = now - age_days * 86_400_000;
            card
        };
        let mut flagged = upload("flagged", 120, 1);
        flagged.video.is_short = true;
        let store = vec![
            upload("older", 150, 3),
            upload("newer", 90, 1),
            upload("long", 600, 1),
            upload("short-length", 45, 1),
            upload("stale", 120, 20),
            upload("known", 120, 1),
            flagged,
        ];
        let known = HashSet::from(["known".to_string()]);
        assert_eq!(short_like(&store, &known, now), ["newer", "older"]);
    }
}
