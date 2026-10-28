use crate::errors::{AppError, AppResult};
use crate::profiles::device_keys::is_device_key;
use sqlx::SqlitePool;

/// Device settings live in Default's database whichever profile is active.
fn pool_for<'a>(pool: &'a SqlitePool, key: &str) -> &'a SqlitePool {
    route(pool, crate::db::device::pool(pool), key)
}

fn route<'a>(profile: &'a SqlitePool, device: &'a SqlitePool, key: &str) -> &'a SqlitePool {
    if is_device_key(key) { device } else { profile }
}

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    let pool = pool_for(pool, key);
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET 
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(AppError::from)?;

    Ok(())
}

pub async fn get_setting(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let pool = pool_for(pool, key);
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)?;

    if let Some(r) = row {
        let value: String = sqlx::Row::get(&r, 0);
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

#[allow(dead_code)]
pub async fn clear_settings(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM settings")
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    Ok(())
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

    #[tokio::test]
    async fn device_keys_go_to_defaults_database() {
        let (profile, device) = (memory().await, memory().await);
        for (key, value) in [("download_location", "/media"), ("theme_id", "ocean")] {
            let pool = route(&profile, &device, key);
            set_setting(pool, key, value).await.unwrap();
        }
        assert_eq!(
            get_setting(&device, "download_location")
                .await
                .unwrap()
                .as_deref(),
            Some("/media")
        );
        assert_eq!(
            get_setting(&profile, "download_location").await.unwrap(),
            None
        );
        assert_eq!(
            get_setting(&profile, "theme_id").await.unwrap().as_deref(),
            Some("ocean")
        );
        assert_eq!(get_setting(&device, "theme_id").await.unwrap(), None);
    }
}
