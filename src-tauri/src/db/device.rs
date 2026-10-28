//! Rows that belong to the whole install (downloads, the sync device id and device settings)
//! live in Default's database. Outside Default the process opens a second pool on that file;
//! the modules that own those rows go through [`pool`], so they can never read or write the
//! active profile's copy of the tables by mistake.

use std::sync::OnceLock;

use sqlx::SqlitePool;

static DEVICE_POOL: OnceLock<SqlitePool> = OnceLock::new();

/// Called once at startup when the active profile isn't Default.
pub fn install(pool: SqlitePool) {
    let _ = DEVICE_POOL.set(pool);
}

/// Default's pool when another profile is active; otherwise (Default, tests) the caller's own.
pub fn pool(profile_pool: &SqlitePool) -> &SqlitePool {
    DEVICE_POOL.get().unwrap_or(profile_pool)
}
