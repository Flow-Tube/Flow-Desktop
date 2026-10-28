//! Persistence for the sync identity, known peers, and the idempotency ledger.
//!
//! Tables are created by migration `0009_create_sync_core.sql`. All queries are runtime (not the
//! compile-time `query!` macro), matching the rest of the codebase, so no `DATABASE_URL` is
//! needed at build time.

use sqlx::SqlitePool;

use crate::sync::error::SyncError;
use crate::sync::identity;

/// Return this device's stable id, creating (and persisting) it on first call.
pub async fn get_or_create_device_id(pool: &SqlitePool) -> Result<String, SyncError> {
    // The device id is shared by every profile; it lives in Default's database.
    let pool = crate::db::device::pool(pool);
    if let Some(id) = sqlx::query_scalar::<_, String>("SELECT device_id FROM sync_identity LIMIT 1")
        .fetch_optional(pool)
        .await?
    {
        return Ok(id);
    }

    let id = identity::new_device_id();
    let name = identity::default_device_name();
    let now = now_iso();
    sqlx::query("INSERT INTO sync_identity (device_id, device_name, created_at) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&name)
        .bind(&now)
        .execute(pool)
        .await?;
    Ok(id)
}

/// The persisted device name (falls back to a generated default if unset).
pub async fn device_name(pool: &SqlitePool) -> Result<String, SyncError> {
    let pool = crate::db::device::pool(pool);
    let name = sqlx::query_scalar::<_, String>("SELECT device_name FROM sync_identity LIMIT 1")
        .fetch_optional(pool)
        .await?;
    Ok(name.unwrap_or_else(identity::default_device_name))
}

/// True if this exact payload from this peer for this collection was already applied — the
/// idempotency guard that makes re-syncing identical data a no-op.
pub async fn already_applied(
    pool: &SqlitePool,
    peer_device_id: &str,
    collection: &str,
    payload_hash: &str,
) -> Result<bool, SyncError> {
    let found = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sync_log WHERE peer_device_id = ? AND collection = ? AND payload_hash = ? LIMIT 1",
    )
    .bind(peer_device_id)
    .bind(collection)
    .bind(payload_hash)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

/// Record that a payload was applied (no-op if already present).
pub async fn record_applied(
    pool: &SqlitePool,
    peer_device_id: &str,
    collection: &str,
    payload_hash: &str,
    hwm_hlc: Option<&str>,
) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT OR IGNORE INTO sync_log (peer_device_id, collection, payload_hash, applied_at, hwm_hlc)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(peer_device_id)
    .bind(collection)
    .bind(payload_hash)
    .bind(now_iso())
    .bind(hwm_hlc)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert or refresh a known peer and stamp the last-synced time.
pub async fn upsert_peer(
    pool: &SqlitePool,
    device_id: &str,
    device_name: &str,
    platform: &str,
) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO sync_peers (device_id, device_name, platform, last_synced_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
            device_name = excluded.device_name,
            platform = excluded.platform,
            last_synced_at = excluded.last_synced_at",
    )
    .bind(device_id)
    .bind(device_name)
    .bind(platform)
    .bind(now_iso())
    .execute(pool)
    .await?;
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
