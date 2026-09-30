use std::sync::Arc;

use tauri::State;

use crate::errors::ErrorResponse;
use crate::models::music::{Artist, SongItem};
use crate::music_brain::mixes::{DailyMixSeed, daily_mixes};
use crate::music_brain::model::MusicBrain;
use crate::music_brain::profile::{MusicTasteProfile, taste_profile};
use crate::music_brain::rank::{RankInput, heavy_rotation, rank};
use crate::music_brain::store::MusicBrainStore;

type CmdResult<T> = Result<T, ErrorResponse>;

/// Resolves a stable artist key: the artist id when present, else a normalized name.
fn artist_key(artist_id: Option<&str>, artist_name: &str) -> String {
    match artist_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => id.to_string(),
        None => artist_name.trim().to_lowercase(),
    }
}

/// Projects a `SongItem` into the minimal shape the ranker needs.
fn song_to_input(song: &SongItem) -> RankInput {
    let track_id = song.video_id.clone().unwrap_or_else(|| song.id.clone());
    let primary = song.artists.first();
    let key = match primary {
        Some(a) => artist_key(a.id.as_deref(), &a.name),
        None => String::new(),
    };
    RankInput {
        track_id,
        artist_key: key,
        genre: None,
    }
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn record_music_interaction(
    track_id: String,
    artist_id: Option<String>,
    artist_name: String,
    title: Option<String>,
    thumbnail: Option<String>,
    genre: Option<String>,
    percent_played: f32,
    is_explicit_like: bool,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<()> {
    let key = artist_key(artist_id.as_deref(), &artist_name);
    music_brain
        .record_interaction(
            &track_id,
            &key,
            Some(artist_name.as_str()),
            title.as_deref(),
            thumbnail.as_deref(),
            genre.as_deref(),
            percent_played,
            is_explicit_like,
        )
        .await;
    Ok(())
}

/// The user's "On Repeat" set — the tracks they currently play most frequently and
/// recently (ACT-R activation), rendered locally from stored display metadata (no
/// network). Returns at most `limit` songs, most-activated first.
#[tauri::command]
pub async fn get_heavy_rotation(
    limit: usize,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<Vec<SongItem>> {
    let now = now_ms();
    let brain = music_brain.read().await;
    let songs = heavy_rotation(&brain, now, limit.clamp(1, 100))
        .into_iter()
        .filter_map(|id| {
            let meta = brain.track_meta.get(&id)?;
            Some(SongItem {
                id: id.clone(),
                title: meta.title.clone(),
                artists: vec![Artist {
                    name: meta.artist.clone(),
                    id: None,
                }],
                album: None,
                duration: None,
                music_video_type: None,
                thumbnail: meta.thumbnail.clone(),
                explicit: false,
                video_id: Some(id),
                playlist_id: None,
                params: None,
                views_text: None,
            })
        })
        .collect();
    Ok(songs)
}

#[tauri::command]
pub async fn dislike_music_artist(
    artist_id: Option<String>,
    artist_name: String,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<()> {
    let key = artist_key(artist_id.as_deref(), &artist_name);
    music_brain.dislike(&key).await;
    Ok(())
}

/// Hard-block an artist ("don't recommend this artist") — a permanent denylist so they
/// never appear in any music surface (ranked shelves, radio, On Repeat, Daily Mixes).
#[tauri::command]
pub async fn block_music_artist(
    artist_id: Option<String>,
    artist_name: String,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<()> {
    let key = artist_key(artist_id.as_deref(), &artist_name);
    if !key.is_empty() {
        music_brain.block_artist(&key).await;
    }
    Ok(())
}

/// Lift a hard block. `artist_key` is the resolved key (artist id, or normalized name) as
/// returned by [`get_blocked_music_artists`].
#[tauri::command]
pub async fn unblock_music_artist(
    artist_key: String,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<()> {
    let key = artist_key.trim();
    if !key.is_empty() {
        music_brain.unblock_artist(key).await;
    }
    Ok(())
}

/// The resolved keys of all hard-blocked artists, for the management UI.
#[tauri::command]
pub async fn get_blocked_music_artists(
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<Vec<String>> {
    Ok(music_brain.blocked_artists().await)
}

/// Reorders YouTube Music candidates by local taste (familiarity / heavy rotation /
/// discovery, per `surface`). A cold/empty brain is a stable pass-through, so this is
/// always safe to call. Surfaces: `quick_picks`, `heavy_rotation`, `radio`, `similar`,
/// `discover`, `daily_discover`.
#[tauri::command]
pub async fn rank_music_candidates(
    songs: Vec<SongItem>,
    surface: String,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<Vec<SongItem>> {
    let inputs: Vec<RankInput> = songs.iter().map(song_to_input).collect();
    let now = now_ms();
    let brain = music_brain.read().await;
    // Hard-block enforcement applies even to the trivial (<=1) case that skips ranking.
    if songs.len() <= 1 {
        return Ok(songs
            .into_iter()
            .zip(inputs.iter())
            .filter(|(_, input)| !brain.is_artist_blocked(&input.artist_key))
            .map(|(song, _)| song)
            .collect());
    }
    let order = rank(&brain, &inputs, &surface, now);
    Ok(order.into_iter().map(|i| songs[i].clone()).collect())
}

/// Daily Mixes — clusters of the user's favorite artists (by co-listening), each as a
/// label plus seed track ids the frontend expands into a playlist via related songs.
/// Empty until cross-session listening has built a co-occurrence graph.
#[tauri::command]
pub async fn get_daily_mixes(
    max_mixes: usize,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<Vec<DailyMixSeed>> {
    let now = now_ms();
    let brain = music_brain.read().await;
    Ok(daily_mixes(&brain, now, max_mixes.clamp(1, 8), 4))
}

#[tauri::command]
pub async fn get_music_brain_snapshot(
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<MusicBrain> {
    Ok(music_brain.snapshot().await)
}

#[tauri::command]
pub async fn get_music_taste_profile(
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> CmdResult<MusicTasteProfile> {
    let now = now_ms();
    let brain = music_brain.read().await;
    Ok(taste_profile(&brain, now))
}

#[tauri::command]
pub async fn reset_music_brain(music_brain: State<'_, Arc<MusicBrainStore>>) -> CmdResult<()> {
    music_brain.reset().await.map_err(ErrorResponse::from)
}
