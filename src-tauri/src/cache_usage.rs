//! What the settings' Cache rows measure, empty and limit. Three stores hold anything Flow can get
//! again: the web view's HTTP cache (almost all of it artwork), the lyrics files, and the network
//! responses kept in the database. There is no media cache: streams aren't stored on disk.
//!
//! The web view owns its cache and can't be told to drop only that while it runs, and its own
//! browsing-data call would take the app's local storage too. So artwork is emptied, and held to
//! its limit, when Flow starts, before the first window opens.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::errors::AppResult;
use crate::profiles::local_state;

pub const DEFAULT_ARTWORK_LIMIT_MB: u64 = 500;
pub const DEFAULT_LYRICS_LIMIT_MB: u64 = 100;
pub const DEFAULT_NETWORK_LIMIT_MB: u64 = 200;
const MB: u64 = 1024 * 1024;
const MAX_WALKED_FILES: usize = 500_000;
const MAX_WALK_DEPTH: usize = 16;

/// Which of the three a row is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CacheKind {
    Artwork,
    Lyrics,
    Network,
}

/// Limits in megabytes, machine-wide; 0 means no limit. `None` is the default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheLocalState {
    pub artwork_limit_mb: Option<u64>,
    pub lyrics_limit_mb: Option<u64>,
    pub network_limit_mb: Option<u64>,
    /// Empty the artwork cache at the next start.
    pub artwork_clear_pending: bool,
}

impl CacheLocalState {
    #[must_use]
    pub fn limit_mb(&self, kind: CacheKind) -> u64 {
        match kind {
            CacheKind::Artwork => self.artwork_limit_mb.unwrap_or(DEFAULT_ARTWORK_LIMIT_MB),
            CacheKind::Lyrics => self.lyrics_limit_mb.unwrap_or(DEFAULT_LYRICS_LIMIT_MB),
            CacheKind::Network => self.network_limit_mb.unwrap_or(DEFAULT_NETWORK_LIMIT_MB),
        }
    }

    pub fn set_limit_mb(&mut self, kind: CacheKind, limit: u64) {
        let slot = match kind {
            CacheKind::Artwork => &mut self.artwork_limit_mb,
            CacheKind::Lyrics => &mut self.lyrics_limit_mb,
            CacheKind::Network => &mut self.network_limit_mb,
        };
        *slot = Some(limit);
    }
}

/// Where the web view keeps its HTTP cache on this system. Only folders the engine names for that
/// purpose: nothing beside them is ever measured or removed.
#[must_use]
pub fn artwork_cache_dirs(identifier: &str, product: &str) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(target_os = "macos") {
        if let Some(cache) = dirs::cache_dir() {
            dirs.push(cache.join(identifier).join("WebKit").join("NetworkCache"));
        }
    } else if cfg!(target_os = "windows") {
        if let Some(local) = dirs::data_local_dir() {
            let profile = local.join(identifier).join("EBWebView").join("Default");
            dirs.push(profile.join("Cache"));
            dirs.push(profile.join("Code Cache"));
        }
    } else if let Some(cache) = dirs::cache_dir() {
        for name in [identifier, product, &product.to_lowercase()] {
            dirs.push(cache.join(name).join("WebKitCache"));
        }
    }
    dirs.dedup();
    dirs
}

/// Bytes under `dir`. A bounded walk: a cache folder is not worth following forever.
#[must_use]
pub fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut files = 0;
    let mut stack = vec![(dir.to_path_buf(), 0)];
    while let Some((current, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                if depth < MAX_WALK_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
            } else if metadata.is_file() {
                total += metadata.len();
                files += 1;
                if files >= MAX_WALKED_FILES {
                    return total;
                }
            }
        }
    }
    total
}

/// Before any window opens: empties the artwork cache if asked to, or if it has gone over its limit.
pub fn tidy_artwork_at_launch(app_data_dir: &Path, cache_dirs: &[PathBuf]) {
    let state = local_state::read(app_data_dir).cache;
    let limit = state.limit_mb(CacheKind::Artwork).saturating_mul(MB);
    let size: u64 = cache_dirs.iter().map(|dir| dir_size(dir)).sum();
    if !state.artwork_clear_pending && (limit == 0 || size <= limit) {
        return;
    }
    for dir in cache_dirs {
        if let Err(error) = std::fs::remove_dir_all(dir)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            // Logging isn't up yet at this point in startup, and the next start tries again.
            eprintln!("could not empty the artwork cache: {error}");
            return;
        }
    }
    if state.artwork_clear_pending {
        local_state::update(app_data_dir, |state| {
            state.cache.artwork_clear_pending = false;
        });
    }
}

/// Removes the oldest files until `dir` fits `limit` bytes; 0 means no limit.
pub fn trim_oldest_files(dir: &Path, limit: u64) {
    if limit == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            metadata.is_file().then(|| {
                (
                    metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
                    metadata.len(),
                    entry.path(),
                )
            })
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    files.sort_by_key(|(modified, _, _)| *modified);
    for (_, size, path) in files {
        if total <= limit {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            total -= size;
        }
    }
}

/// The response caches: every one of these is fetched again when it is next needed. Learned state,
/// history and the subscription feed's stored uploads are not caches and stay out of this.
const NETWORK_CACHE_TABLES: [(&str, &str); 6] = [
    ("music_home_typed_cache", "page_json"),
    ("music_home_sections", "tracks_json"),
    ("music_content_cache", "payload_json"),
    ("home_feed_cache", "video"),
    (
        "video_cache",
        "COALESCE(title, '') || COALESCE(channel_name, '') || COALESCE(thumbnail_url, '') || COALESCE(description, '')",
    ),
    (
        "dearrow_cache",
        "COALESCE(title, '') || COALESCE(thumbnail_url, '')",
    ),
];

/// Bytes of the stored responses, as the text they hold.
pub async fn network_cache_size(pool: &SqlitePool) -> AppResult<u64> {
    let mut total = 0_u64;
    for (table, column) in NETWORK_CACHE_TABLES {
        let sql = format!("SELECT COALESCE(SUM(LENGTH(CAST({column} AS BLOB))), 0) FROM {table}");
        let bytes: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .fetch_one(pool)
            .await?;
        total += bytes.max(0).cast_unsigned();
    }
    Ok(total)
}

pub async fn clear_network_cache(pool: &SqlitePool) -> AppResult<()> {
    for (table, _) in NETWORK_CACHE_TABLES {
        sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {table}")))
            .execute(pool)
            .await?;
    }
    sqlx::query("DELETE FROM music_home_chips")
        .execute(pool)
        .await?;
    Ok(())
}

/// Responses are all as cheap to get back, so going over the limit simply starts them afresh.
pub async fn hold_network_cache_to(pool: &SqlitePool, limit_mb: u64) -> AppResult<()> {
    let limit = limit_mb.saturating_mul(MB);
    if limit > 0 && network_cache_size(pool).await? > limit {
        clear_network_cache(pool).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("flow-cache-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![0_u8; bytes]).unwrap();
    }

    #[test]
    fn sizes_count_nested_files_and_a_missing_folder_is_empty() {
        let dir = TempDir::new();
        write(&dir.0.join("a"), 10);
        write(&dir.0.join("sub/deeper/b"), 5);
        assert_eq!(dir_size(&dir.0), 15);
        assert_eq!(dir_size(&dir.0.join("missing")), 0);
    }

    #[test]
    fn artwork_within_its_limit_is_left_alone() {
        let dir = TempDir::new();
        let cache = dir.0.join("NetworkCache");
        write(&cache.join("image"), 1024);
        tidy_artwork_at_launch(&dir.0, std::slice::from_ref(&cache));
        assert!(cache.join("image").exists());
    }

    #[test]
    fn artwork_is_emptied_when_asked_and_only_once() {
        let dir = TempDir::new();
        let cache = dir.0.join("NetworkCache");
        write(&cache.join("image"), 1024);
        write(&dir.0.join("beside/keep"), 1);
        local_state::update(&dir.0, |state| state.cache.artwork_clear_pending = true);

        tidy_artwork_at_launch(&dir.0, std::slice::from_ref(&cache));
        assert!(!cache.exists());
        assert!(dir.0.join("beside/keep").exists());
        assert!(!local_state::read(&dir.0).cache.artwork_clear_pending);
    }

    #[test]
    fn artwork_over_its_limit_is_emptied_at_launch() {
        let dir = TempDir::new();
        let cache = dir.0.join("NetworkCache");
        write(&cache.join("image"), 2 * 1024 * 1024);
        local_state::update(&dir.0, |state| {
            state.cache.set_limit_mb(CacheKind::Artwork, 1);
        });
        tidy_artwork_at_launch(&dir.0, std::slice::from_ref(&cache));
        assert!(!cache.exists());
    }

    #[test]
    fn no_limit_means_no_limit() {
        let dir = TempDir::new();
        let cache = dir.0.join("NetworkCache");
        write(&cache.join("image"), 2 * 1024 * 1024);
        local_state::update(&dir.0, |state| {
            state.cache.set_limit_mb(CacheKind::Artwork, 0);
        });
        tidy_artwork_at_launch(&dir.0, std::slice::from_ref(&cache));
        assert!(cache.join("image").exists());
    }

    #[test]
    fn lyrics_lose_their_oldest_files_first() {
        let dir = TempDir::new();
        for (name, age) in [("old", 300), ("mid", 200), ("new", 100)] {
            let path = dir.0.join(name);
            write(&path, 100);
            let when = std::time::SystemTime::now() - std::time::Duration::from_secs(age);
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(when)
                .unwrap();
        }
        trim_oldest_files(&dir.0, 200);
        assert!(!dir.0.join("old").exists());
        assert!(dir.0.join("mid").exists());
        assert!(dir.0.join("new").exists());

        trim_oldest_files(&dir.0, 0);
        assert!(dir.0.join("mid").exists(), "0 means no limit");
    }

    #[test]
    fn limits_default_until_set() {
        let mut state = CacheLocalState::default();
        assert_eq!(state.limit_mb(CacheKind::Artwork), DEFAULT_ARTWORK_LIMIT_MB);
        state.set_limit_mb(CacheKind::Network, 0);
        assert_eq!(state.limit_mb(CacheKind::Network), 0);
        assert_eq!(state.limit_mb(CacheKind::Lyrics), DEFAULT_LYRICS_LIMIT_MB);
    }

    #[tokio::test]
    async fn network_responses_are_measured_and_cleared_without_touching_the_rest() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO music_home_typed_cache VALUES ('a', ?, 1)")
            .bind("x".repeat(1000))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO dearrow_cache (video_id, title) VALUES ('v', ?)")
            .bind("é".repeat(10))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO watch_history
                (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
                 total_duration_seconds, is_music, is_short, updated_hlc)
             VALUES ('v1', 't', 'c', 'UC', '2025-01-01T00:00:00+00:00', 1, 2, 0, 0, '1:0:d')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(network_cache_size(&pool).await.unwrap(), 1020);

        hold_network_cache_to(&pool, 1).await.unwrap();
        assert_eq!(
            network_cache_size(&pool).await.unwrap(),
            1020,
            "within its limit"
        );
        hold_network_cache_to(&pool, 0).await.unwrap();
        assert_eq!(
            network_cache_size(&pool).await.unwrap(),
            1020,
            "0 means no limit"
        );

        clear_network_cache(&pool).await.unwrap();
        assert_eq!(network_cache_size(&pool).await.unwrap(), 0);
        let history: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM watch_history")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(history, 1);
    }
}
