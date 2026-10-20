use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::warn;

use crate::db::{settings, watch_history};
use crate::errors::AppResult;
use crate::flow_neuro::key_migration::{spell_from_titles, to_key_spec_2};
use crate::flow_neuro::language::system_language;
use crate::flow_neuro::maintenance::migrate;
use crate::flow_neuro::scoring::UserBrain;

/// The setting the brain is stored under.
pub const BRAIN_SETTING: &str = "user_neuro_brain";
/// The brain as it was before its one-time tidy ([`crate::flow_neuro::maintenance`]); its
/// presence also marks the tidy done on this device.
pub const BRAIN_BEFORE_MIGRATION_SETTING: &str = "user_neuro_brain_before_v14";
/// How many recent titles spell the keys of a brain converted to key spec 2.
pub const SPELLING_TITLES: i64 = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum InteractionType {
    Click,
    Liked,
    Watched,
    Skipped,
    Disliked,
    /// Watch later, a playlist or a download: a strong signal, weaker than a like.
    Saved,
    /// "Not interested" on a card: hides the video for good and its channel for a while.
    NotInterested,
}

impl InteractionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Click => "CLICK",
            Self::Liked => "LIKED",
            Self::Watched => "WATCHED",
            Self::Skipped => "SKIPPED",
            Self::Disliked => "DISLIKED",
            Self::Saved => "SAVED",
            Self::NotInterested => "NOT_INTERESTED",
        }
    }
}

/// The key of a link between two topics, the way Flow for Android writes it ("a|b", in order).
pub fn make_affinity_key(t1: &str, t2: &str) -> String {
    if t1 < t2 {
        format!("{t1}|{t2}")
    } else {
        format!("{t2}|{t1}")
    }
}

/// Brings a brain read from storage or an import up to the running schema, languages and key
/// spec. Returns whether anything changed, so the caller knows to save it.
pub async fn settle_brain(pool: &SqlitePool, brain: &mut UserBrain) -> AppResult<bool> {
    let mut changed = brain.schema_version != crate::flow_neuro::scoring::SCHEMA_VERSION;
    brain.schema_version = crate::flow_neuro::scoring::SCHEMA_VERSION;
    changed |= brain.settle_languages(&system_language());
    if to_key_spec_2(brain) {
        let titles = watch_history::recent_video_titles(pool, SPELLING_TITLES).await?;
        spell_from_titles(brain, &titles);
        tracing::info!("[FlowNeuro] brain converted to key spec 2");
        changed = true;
    }
    // Sync carries the higher of two devices' schema numbers, so the schema cannot say whether
    // this device tidied its brain; the kept copy does.
    if settings::get_setting(pool, BRAIN_BEFORE_MIGRATION_SETTING)
        .await?
        .is_none()
    {
        let before = serde_json::to_string(brain).unwrap_or_default();
        settings::set_setting(pool, BRAIN_BEFORE_MIGRATION_SETTING, &before).await?;
        migrate(brain);
        tracing::info!("[FlowNeuro] brain tidied for the evidence horizons");
        changed = true;
    }
    Ok(changed)
}

pub async fn get_or_create_brain(pool: &SqlitePool) -> AppResult<UserBrain> {
    if let Some(json_str) = settings::get_setting(pool, BRAIN_SETTING).await? {
        match serde_json::from_str::<UserBrain>(&json_str) {
            Ok(mut brain) => {
                if settle_brain(pool, &mut brain).await? {
                    save_brain(pool, &brain).await?;
                }
                return Ok(brain);
            }
            Err(error) => {
                // The next save writes a fresh brain over this key, so the unreadable one is
                // kept under its own key for recovery first.
                let backup = format!(
                    "{BRAIN_SETTING}_corrupt_{}",
                    chrono::Utc::now().format("%Y%m%d%H%M%S")
                );
                settings::set_setting(pool, &backup, &json_str).await?;
                warn!(
                    error = %error,
                    backup = %backup,
                    "[FlowNeuro] Stored brain failed to deserialize; kept a copy and started a new one"
                );
            }
        }
    }
    let mut default_brain = UserBrain::default();
    default_brain.settle_languages(&system_language());
    save_brain(pool, &default_brain).await?;
    Ok(default_brain)
}

pub async fn save_brain(pool: &SqlitePool, brain: &UserBrain) -> AppResult<()> {
    let json_str = serde_json::to_string(brain).unwrap();
    settings::set_setting(pool, BRAIN_SETTING, &json_str).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow_neuro::learning::{Interaction, apply_interaction};

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn a_corrupt_brain_is_kept_before_a_new_one_replaces_it() {
        let pool = pool().await;
        settings::set_setting(&pool, BRAIN_SETTING, "{not json")
            .await
            .unwrap();
        let brain = get_or_create_brain(&pool).await.unwrap();
        assert_eq!(brain.total_interactions, 0);

        let backups: Vec<(String, String)> = sqlx::query_as(
            "SELECT key, value FROM settings WHERE key LIKE 'user_neuro_brain_corrupt_%'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].1, "{not json");
        let stored = settings::get_setting(&pool, BRAIN_SETTING)
            .await
            .unwrap()
            .unwrap();
        assert!(serde_json::from_str::<UserBrain>(&stored).is_ok());
    }

    #[tokio::test]
    async fn a_stored_brain_loads_as_saved() {
        let pool = pool().await;
        let mut brain = UserBrain::default();
        apply_interaction(
            &mut brain,
            &Interaction {
                video_id: "v1",
                title: "Rust compiler internals explained",
                channel_name: "Some Channel",
                channel_id: "chan1",
                description: None,
                duration_sec: Some(600),
                is_live: false,
                is_short: false,
                kind: InteractionType::Liked,
                percent_watched: 0.0,
                seconds_since_impression: None,
            },
        );
        save_brain(&pool, &brain).await.unwrap();
        let loaded = get_or_create_brain(&pool).await.unwrap();
        assert_eq!(loaded.total_interactions, 1);
        assert_eq!(
            loaded.global_vector.topics.len(),
            brain.global_vector.topics.len()
        );
        assert_eq!(
            loaded.recent_vector.topics.len(),
            brain.recent_vector.topics.len()
        );
    }

    #[tokio::test]
    async fn the_first_load_keeps_a_copy_then_tidies_once() {
        let pool = pool().await;
        let mut brain = UserBrain::default();
        brain.global_vector.topics.insert("the".into(), 0.4);
        brain.global_vector.anchor_topics.insert("chess".into());
        save_brain(&pool, &brain).await.unwrap();

        let loaded = get_or_create_brain(&pool).await.unwrap();
        assert!(!loaded.global_vector.topics.contains_key("the"));
        assert!(loaded.global_vector.anchor_topics.is_empty());
        let before = settings::get_setting(&pool, BRAIN_BEFORE_MIGRATION_SETTING)
            .await
            .unwrap()
            .unwrap();
        let before: UserBrain = serde_json::from_str(&before).unwrap();
        assert!(before.global_vector.topics.contains_key("the"));

        let mut again = loaded.clone();
        again.global_vector.anchor_topics.insert("rust".into());
        save_brain(&pool, &again).await.unwrap();
        let reloaded = get_or_create_brain(&pool).await.unwrap();
        assert!(reloaded.global_vector.anchor_topics.contains("rust"));
    }
}
