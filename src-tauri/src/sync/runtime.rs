//! What a sync does around the database, for both protocols: flushing and reloading the resident
//! brains, and filling album tracks before sending playlists.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::music_brain::store::MusicBrainStore;
use crate::services::music_service::{Freshness, MusicService};
use crate::services::recommendation_service::RecommendationService;
use crate::sync::canonical::Collection;
use crate::sync::export;
use crate::sync::protocol::OutgoingCollection;

pub async fn flush_brains(app: &AppHandle) {
    if let Some(svc) = app.try_state::<RecommendationService>()
        && let Err(e) = svc.flush_brain().await
    {
        tracing::warn!(%e, "[sync] flush flow_neuro brain before merge failed");
    }
    if let Some(store) = app.try_state::<Arc<MusicBrainStore>>()
        && let Err(e) = store.flush().await
    {
        tracing::warn!(%e, "[sync] flush music brain before merge failed");
    }
}

/// As [`flush_brains`], then holds the video brain's saves until [`reload_brains`], so its
/// background save cannot write the old brain over the one the merge stores.
pub async fn flush_and_hold_brains(app: &AppHandle) {
    flush_brains(app).await;
    if let Some(svc) = app.try_state::<RecommendationService>()
        && let Err(e) = svc.flush_and_hold_brain().await
    {
        tracing::warn!(%e, "[sync] hold flow_neuro brain before merge failed");
    }
}

pub async fn reload_brains(app: &AppHandle) {
    if let Some(svc) = app.try_state::<RecommendationService>()
        && let Err(e) = svc.reload_brain().await
    {
        tracing::warn!(%e, "[sync] reload flow_neuro brain after merge failed");
    }
    if let Some(store) = app.try_state::<Arc<MusicBrainStore>>()
        && let Err(e) = store.reload().await
    {
        tracing::warn!(%e, "[sync] reload music brain after merge failed");
    }
}

pub async fn enrich_outgoing_albums(app: &AppHandle, outgoing: &mut [OutgoingCollection]) {
    let Some(pl) = outgoing
        .iter_mut()
        .find(|o| o.collection == Collection::Playlists)
    else {
        return;
    };
    let browse_ids = export::album_browse_ids_missing_tracks(&pl.ndjson);
    if browse_ids.is_empty() {
        return;
    }
    let Some(music) = app.try_state::<MusicService>() else {
        return;
    };
    let mut tracks: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for id in browse_ids {
        match music.album(&id, Freshness::Cached).await {
            Ok(page) => {
                let cover = page.album.thumbnail.clone();
                let songs: Vec<Value> = page
                    .songs
                    .iter()
                    .filter_map(|s| {
                        let mut v = serde_json::to_value(s).ok()?;
                        if !cover.is_empty()
                            && let Some(obj) = v.as_object_mut()
                        {
                            let has = obj
                                .get("thumbnail")
                                .and_then(Value::as_str)
                                .is_some_and(|t| !t.is_empty());
                            if !has {
                                obj.insert("thumbnail".to_string(), Value::String(cover.clone()));
                            }
                        }
                        Some(v)
                    })
                    .collect();
                if !songs.is_empty() {
                    tracks.insert(id, songs);
                }
            }
            Err(error) => {
                tracing::warn!(target: "flow::sync::session", album = %id, %error, "album track fetch failed; album sent without tracks");
            }
        }
    }
    if !tracks.is_empty() {
        pl.ndjson = export::fill_album_tracks(&pl.ndjson, &tracks);
    }
}
