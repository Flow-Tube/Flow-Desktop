use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::errors::ErrorResponse;
use crate::music_brain::store::MusicBrainStore;
use crate::profiles::registry::{Profile, ProfileAvatar};
use crate::services::profile_service::{NewProfile, ProfileService, ProfilesView};
use crate::services::recommendation_service::RecommendationService;
use crate::sync::session::SyncManager;
use crate::sync2::profile_actions;

#[tauri::command]
pub fn profiles_list(service: State<'_, ProfileService>) -> Result<ProfilesView, ErrorResponse> {
    service.list().map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn profiles_create(
    request: NewProfile,
    pool: State<'_, SqlitePool>,
    service: State<'_, ProfileService>,
    recommendation: State<'_, RecommendationService>,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> Result<Profile, ErrorResponse> {
    async {
        // A copied engine is read from the database; the resident brains hold the newest state.
        if request.copy.recommendations {
            recommendation.flush_brain().await?;
            music_brain.flush().await?;
        }
        service.create(&pool, request).await
    }
    .await
    .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn profiles_rename(
    app: AppHandle,
    id: String,
    name: String,
    service: State<'_, ProfileService>,
) -> Result<Profile, ErrorResponse> {
    let profile = service
        .rename(&id, &name)
        .await
        .map_err(ErrorResponse::from)?;
    if let Err(error) = profile_actions::renamed(&app, &id, &profile.name).await {
        tracing::warn!(target: "flow::sync2", kind = error.kind(), "synced profile name not updated");
    }
    Ok(profile)
}

#[tauri::command]
pub async fn profiles_set_look(
    id: String,
    color_key: String,
    avatar: ProfileAvatar,
    service: State<'_, ProfileService>,
) -> Result<Profile, ErrorResponse> {
    service
        .set_look(&id, &color_key, avatar)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn profiles_delete(
    app: AppHandle,
    id: String,
    pool: State<'_, SqlitePool>,
    service: State<'_, ProfileService>,
) -> Result<(), ErrorResponse> {
    service
        .delete(&pool, &id)
        .await
        .map_err(ErrorResponse::from)?;
    profile_actions::deleted(&app, &id)
        .await
        .map_err(|e| crate::commands::linked::err(&e))
}

#[tauri::command]
pub async fn profiles_prepare_switch(
    id: String,
    app: AppHandle,
    service: State<'_, ProfileService>,
    sync: State<'_, Arc<SyncManager>>,
) -> Result<(), ErrorResponse> {
    let sync_busy = sync.is_busy().await || crate::sync2::service::is_syncing(&app);
    service
        .prepare_switch(&id, sync_busy)
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub fn profiles_cancel_switch(service: State<'_, ProfileService>) {
    service.cancel_switch();
}

/// The last step of a switch, once every window has saved its work: flush the engines,
/// make the profile active for the next process, and relaunch.
#[tauri::command]
pub async fn profiles_switch(
    id: String,
    app: AppHandle,
    service: State<'_, ProfileService>,
    recommendation: State<'_, RecommendationService>,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> Result<(), ErrorResponse> {
    async {
        recommendation.settle_watch_session(None).await?;
        recommendation.flush_brain().await?;
        music_brain.flush().await?;
        service.finish_switch(&id).await
    }
    .await
    .map_err(ErrorResponse::from)?;
    crate::relaunch::request();
    app.exit(0);
    Ok(())
}

/// A link that arrived during a switch; opened by the next process instead.
#[tauri::command]
pub fn profiles_hold_link(url: String, service: State<'_, ProfileService>) -> bool {
    service.hold_link(&url)
}

#[tauri::command]
pub fn profiles_take_held_link(service: State<'_, ProfileService>) -> Option<String> {
    service.take_held_link()
}

/// Makes the picture at `path` (chosen in the system file dialog) the profile's avatar.
#[tauri::command]
pub async fn profiles_set_photo(
    id: String,
    path: String,
    service: State<'_, ProfileService>,
) -> Result<Profile, ErrorResponse> {
    service
        .set_photo(&id, path.into())
        .await
        .map_err(ErrorResponse::from)
}
