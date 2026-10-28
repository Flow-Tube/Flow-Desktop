use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

pub mod cache;
pub mod device;
pub mod download_collections;
pub mod download_jobs;
pub mod downloads;
pub mod known_shorts;
pub mod library;
pub mod music_content;
pub mod music_home;
pub mod music_queue;
pub mod neuro_stores;
pub mod notifications;
pub mod recommendations;
pub mod seen_videos;
pub mod settings;
pub mod unplayable_videos;
pub mod video_kind_checks;
pub mod watch_history;

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

use crate::errors::{AppError, AppResult};

/// Opens the active profile's database in `dir` (Default's is the app data folder itself).
pub async fn initialize_database(dir: PathBuf) -> AppResult<SqlitePool> {
    let pool = open_migrated(dir, 10).await?;

    if let Err(error) = sqlx::query("PRAGMA optimize;").execute(&pool).await {
        tracing::warn!(%error, "PRAGMA optimize after migrations failed");
    }

    // Bound the recommendation event log so it cannot grow without limit across sessions.
    if let Err(error) = recommendations::prune_recommendation_events(&pool, 2000).await {
        tracing::warn!(%error, "Failed to prune recommendation events");
    }

    Ok(pool)
}

/// Opens Default's database for the rows every profile shares (see [`device`]), without
/// touching Default's own data.
pub async fn open_device_database(app_data_dir: PathBuf) -> AppResult<SqlitePool> {
    open_migrated(app_data_dir, 2).await
}

/// A newer build's migrations don't stop this one from opening the database. That only works
/// while migrations stay additive (new tables, nullable or defaulted columns), so an older build
/// can keep using a database a newer one has migrated.
fn migrator() -> sqlx::migrate::Migrator {
    let mut migrator = sqlx::migrate!("./migrations");
    migrator.set_ignore_missing(true);
    migrator
}

/// Opens a profile that isn't running, such as for a master backup.
pub async fn open_closed_profile(dir: PathBuf) -> AppResult<SqlitePool> {
    open_migrated(dir, 2).await
}

async fn open_migrated(dir: PathBuf, max_connections: u32) -> AppResult<SqlitePool> {
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;

    let db_path = dir.join("flow-desktop.sqlite");
    let database_url = format!("sqlite://{}", db_path.to_string_lossy());

    // Ensure SQLite database file is created if it does not exist
    if !db_path.exists() {
        std::fs::File::create(&db_path)
            .map_err(|error| AppError::Internal(format!("Failed to create DB file: {error}")))?;
    }

    // 1. Configure the SQLite connection specifically for high concurrency
    let connection_options = SqliteConnectOptions::from_str(&database_url)
        .map_err(AppError::from)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal) // Allows concurrent readers!
        .synchronous(SqliteSynchronous::Normal) // Massive write speed improvement
        .busy_timeout(Duration::from_secs(5)) // Prevent "database is locked" errors
        .pragma("cache_size", "-16000") // ~16 MB page cache per connection
        .pragma("mmap_size", "134217728") // 128 MB memory-mapped I/O
        .pragma("temp_store", "MEMORY") // keep ORDER BY / temp b-trees in RAM
        .optimize_on_close(true, Some(400));

    // 2. Build the optimized Connection Pool
    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .min_connections(1)
        .idle_timeout(Duration::from_secs(90))
        .connect_with(connection_options)
        .await
        .map_err(AppError::from)?;

    // Self-healing query: Ensure settings table is created immediately in case of migration mismatches
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );",
    )
    .execute(&pool)
    .await
    .map_err(AppError::from)?;

    // Run migrations compile-time verified
    migrator()
        .run(&pool)
        .await
        .map_err(|error| AppError::Internal(format!("DB migration failed: {error}")))?;

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_database_from_a_newer_build_still_opens() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrator().run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (99999, 'from a newer build', 1, x'00', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        migrator().run(&pool).await.unwrap();
    }
}
