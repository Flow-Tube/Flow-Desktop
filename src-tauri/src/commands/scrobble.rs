use std::sync::Arc;

use tauri::State;

use crate::errors::ErrorResponse;
use crate::scrobble::models::Service;
use crate::scrobble::rules::TrackInfo;
use crate::scrobble::scrobbler::{ScrobbleStatus, Scrobbler};

type Scrobbling<'a> = State<'a, Arc<Scrobbler>>;

/// Accounts, waiting listens and whether Last.fm sign-in has a key.
#[tauri::command]
pub async fn scrobble_status(scrobbler: Scrobbling<'_>) -> Result<ScrobbleStatus, ErrorResponse> {
    Ok(scrobbler.status().await?)
}

/// Sign in with a user name and password, or a `ListenBrainz` user token in `secret`.
#[tauri::command]
pub async fn scrobble_sign_in(
    service: Service,
    user_name: String,
    secret: String,
    scrobbler: Scrobbling<'_>,
) -> Result<(), ErrorResponse> {
    Ok(scrobbler.sign_in(service, &user_name, &secret).await?)
}

#[tauri::command]
pub async fn scrobble_sign_out(
    service: Service,
    scrobbler: Scrobbling<'_>,
) -> Result<(), ErrorResponse> {
    Ok(scrobbler.sign_out(service).await?)
}

/// Use the listener's own Last.fm API key, or go back to the build's. A missing key or
/// secret keeps the stored one.
#[tauri::command]
pub async fn scrobble_set_own_key(
    enabled: bool,
    api_key: Option<String>,
    secret: Option<String>,
    scrobbler: Scrobbling<'_>,
) -> Result<(), ErrorResponse> {
    Ok(scrobbler.set_own_key(enabled, api_key, secret).await?)
}

/// Read the keychain again after the listener refused or it was locked.
#[tauri::command]
pub async fn scrobble_retry_keychain(scrobbler: Scrobbling<'_>) -> Result<(), ErrorResponse> {
    Ok(scrobbler.retry_keychain().await?)
}

/// The song started playing for real.
#[tauri::command]
pub async fn scrobble_now_playing(
    track: TrackInfo,
    scrobbler: Scrobbling<'_>,
) -> Result<(), ErrorResponse> {
    Ok(scrobbler.now_playing(&track).await?)
}

/// The song has played long enough to count; queued at once so a later quit cannot lose it.
#[tauri::command]
pub async fn scrobble_listened(
    track: TrackInfo,
    played_ms: u64,
    started_at_ms: i64,
    scrobbler: Scrobbling<'_>,
) -> Result<bool, ErrorResponse> {
    Ok(scrobbler.listened(&track, played_ms, started_at_ms).await?)
}

/// A song was liked or unliked.
#[tauri::command]
pub async fn scrobble_love(
    track: TrackInfo,
    loved: bool,
    scrobbler: Scrobbling<'_>,
) -> Result<(), ErrorResponse> {
    Ok(scrobbler.love(&track, loved).await?)
}

/// Send waiting listens now. False when some are still waiting.
#[tauri::command]
pub async fn scrobble_flush(scrobbler: Scrobbling<'_>) -> Result<bool, ErrorResponse> {
    Ok(scrobbler.flush().await?)
}
