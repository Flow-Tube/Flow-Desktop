//! A profile's interests as the Flow Neuro page shows them: its brain, persona and music taste.
//! For a profile that isn't running, they are read from its own database on this device, without
//! loading it (Flow-Tube/Flow#1034).

use serde::Serialize;
use sqlx::SqlitePool;

use crate::errors::AppResult;
use crate::flow_neuro::scoring::{FlowPersona, UserBrain, classify_persona};
use crate::flow_neuro::signals::stored_brain;
use crate::music_brain::profile::{MusicTasteProfile, taste_profile};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDetails {
    pub name: String,
    pub title: String,
    pub description: String,
    pub icon: String,
}

impl From<FlowPersona> for PersonaDetails {
    fn from(persona: FlowPersona) -> Self {
        Self {
            name: persona.name().to_string(),
            title: persona.title().to_string(),
            description: persona.description().to_string(),
            icon: persona.icon().to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInterests {
    pub brain: UserBrain,
    pub persona: PersonaDetails,
    pub music: MusicTasteProfile,
}

/// The interests stored in a profile's database `pool`, read only.
pub async fn stored_interests(pool: &SqlitePool, now_ms: u64) -> AppResult<ProfileInterests> {
    let brain = stored_brain(pool).await?;
    let music = crate::music_brain::store::stored_brain(pool).await?;
    Ok(ProfileInterests {
        persona: classify_persona(&brain).into(),
        music: taste_profile(&music, now_ms),
        brain,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn profile_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn setting(pool: &SqlitePool, key: &str) -> Option<String> {
        sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_stored_brain_is_shown_as_it_is() {
        let pool = profile_pool().await;
        let json = r#"{"blocked_topics":["cooking"]}"#;
        sqlx::query("INSERT INTO settings (key, value) VALUES ('user_neuro_brain', ?)")
            .bind(json)
            .execute(&pool)
            .await
            .unwrap();

        let interests = stored_interests(&pool, 0).await.unwrap();
        assert!(interests.brain.blocked_topics.contains("cooking"));
        assert!(!interests.persona.name.is_empty());
        assert_eq!(
            setting(&pool, "user_neuro_brain").await.as_deref(),
            Some(json),
            "reading leaves the profile's brain untouched"
        );
    }

    #[tokio::test]
    async fn a_profile_without_brains_shows_fresh_ones_and_stores_nothing() {
        let pool = profile_pool().await;
        let interests = stored_interests(&pool, 0).await.unwrap();
        assert!(interests.brain.blocked_topics.is_empty());
        assert_eq!(setting(&pool, "user_neuro_brain").await, None);
        assert_eq!(setting(&pool, "user_music_brain").await, None);
    }
}
