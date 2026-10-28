use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::errors::{AppResult, ErrorResponse};
use crate::music_brain::store::MusicBrainStore;
use crate::profiles::registry::{Profile, ProfileAvatar};
use crate::services::profile_service::{NewProfile, ProfileService, ProfilesView};
use crate::services::recommendation_service::RecommendationService;
use crate::sync::session::SyncManager;

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
    id: String,
    name: String,
    service: State<'_, ProfileService>,
) -> Result<Profile, ErrorResponse> {
    service
        .rename(&id, &name)
        .await
        .map_err(ErrorResponse::from)
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
    id: String,
    service: State<'_, ProfileService>,
) -> Result<(), ErrorResponse> {
    let result: AppResult<()> = service.delete(&id).await;
    result.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn profiles_prepare_switch(
    id: String,
    service: State<'_, ProfileService>,
    sync: State<'_, Arc<SyncManager>>,
) -> Result<(), ErrorResponse> {
    let sync_busy = sync.is_busy().await;
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
