//! The music player's saved queue and long-track positions (migration 0018).

use crate::errors::{AppError, AppResult};
use sqlx::{Row, SqlitePool};

pub async fn save_queue_state(pool: &SqlitePool, state: &str, saved_at: i64) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO music_queue_state (id, state, saved_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, saved_at = excluded.saved_at",
    )
    .bind(state)
    .bind(saved_at)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

pub async fn load_queue_state(pool: &SqlitePool) -> AppResult<Option<String>> {
    let row = sqlx::query("SELECT state FROM music_queue_state WHERE id = 1")
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(|row| row.get::<String, _>(0)))
}

pub async fn clear_queue_state(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM music_queue_state")
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

pub async fn save_resume_position(
    pool: &SqlitePool,
    video_id: &str,
    position_seconds: f64,
    duration_seconds: f64,
    updated_at: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO music_resume_positions (video_id, position_seconds, duration_seconds, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            updated_at = excluded.updated_at",
    )
    .bind(video_id)
    .bind(position_seconds)
    .bind(duration_seconds)
    .bind(updated_at)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

pub async fn get_resume_position(pool: &SqlitePool, video_id: &str) -> AppResult<Option<f64>> {
    let row = sqlx::query("SELECT position_seconds FROM music_resume_positions WHERE video_id = ?")
        .bind(video_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(|row| row.get::<f64, _>(0)))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    async fn the_queue_keeps_only_its_latest_state() {
        let pool = pool().await;
        assert_eq!(load_queue_state(&pool).await.unwrap(), None);
        save_queue_state(&pool, r#"{"v":1}"#, 1).await.unwrap();
        save_queue_state(&pool, r#"{"v":2}"#, 2).await.unwrap();
        assert_eq!(
            load_queue_state(&pool).await.unwrap().as_deref(),
            Some(r#"{"v":2}"#)
        );
        clear_queue_state(&pool).await.unwrap();
        assert_eq!(load_queue_state(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_long_track_remembers_where_it_was_left() {
        let pool = pool().await;
        assert_eq!(get_resume_position(&pool, "mix").await.unwrap(), None);
        save_resume_position(&pool, "mix", 600.0, 3600.0, 1)
            .await
            .unwrap();
        save_resume_position(&pool, "mix", 1200.5, 3600.0, 2)
            .await
            .unwrap();
        assert_eq!(
            get_resume_position(&pool, "mix").await.unwrap(),
            Some(1200.5)
        );
    }
}
