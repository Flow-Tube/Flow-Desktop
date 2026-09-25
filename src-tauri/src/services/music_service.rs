//! Thin service over the concrete [`InnertubeClient`] exposing the additive
//! YouTube Music surface. Kept separate from [`crate::services::youtube_service`]
//! (which is a `dyn YoutubeExtractor` and drives the video path) so the music
//! feature is independently wired and the video path is untouched.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use serde::{Serialize, de::DeserializeOwned};
use sqlx::SqlitePool;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::music::client::record_public_cache_hit;
use crate::db::music_content;
use crate::errors::AppResult;
use crate::models::music::{
    AlbumItem, ArtistPage, ChartsPage, ExplorePage, MoodAndGenreGroup, MoodAndGenreItem, SongItem,
    YTItem,
};
use crate::models::music_pages::{
    AlbumPage, MoodGenrePage, MusicHomePage, MusicPlaylistPage, MusicSearchResponse,
    MusicSearchSuggestions, QueuePage, RelatedPage, RelatedShelfType, SearchSummaryPage,
};
use crate::models::music_stream::{MusicAudioQuality, MusicStreamInfo};

const PAGE_MAX_AGE_SECONDS: i64 = 7 * 24 * 60 * 60;
const ALBUM_MAX_AGE_SECONDS: i64 = 30 * 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    Network,
    Cached,
}

impl Freshness {
    #[must_use]
    pub fn prefer_cached(prefer: Option<bool>) -> Self {
        if prefer == Some(true) {
            Self::Cached
        } else {
            Self::Network
        }
    }
}

fn track_edges(songs: &[SongItem]) -> Vec<(String, YTItem)> {
    songs
        .iter()
        .cloned()
        .map(|song| ("tracks".into(), YTItem::Song(song)))
        .collect()
}

fn artist_edges(page: &ArtistPage) -> Vec<(String, YTItem)> {
    page.sections
        .iter()
        .flat_map(|section| {
            section.items.iter().cloned().map(|item| {
                let relation = match &item {
                    YTItem::Artist(_) => "similarArtists",
                    YTItem::Playlist(_) => "artistPlaylists",
                    YTItem::Album(_) => "releases",
                    YTItem::Song(_) => "artistTracks",
                    _ => "artistSection",
                };
                (relation.into(), item)
            })
        })
        .collect()
}

fn related_edges(page: &RelatedPage) -> Vec<(String, YTItem)> {
    page.sections
        .iter()
        .flat_map(|section| {
            let relation = match section.shelf_type {
                RelatedShelfType::Similar => "similar",
                RelatedShelfType::Playlists => "playlists",
                RelatedShelfType::OtherPerformances => "otherPerformances",
                RelatedShelfType::SimilarArtists => "similarArtists",
                RelatedShelfType::MoreFromArtist => "moreFromArtist",
                RelatedShelfType::Unknown => "unknown",
            };
            section
                .items
                .iter()
                .cloned()
                .map(move |item| (relation.into(), item))
        })
        .collect()
}

#[derive(Clone)]
pub struct MusicService {
    client: Arc<InnertubeClient>,
    pool: SqlitePool,
    inflight: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl MusicService {
    #[must_use]
    pub fn new(client: Arc<InnertubeClient>, pool: SqlitePool) -> Self {
        Self {
            client,
            pool,
            inflight: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn lock_for(&self, kind: &str, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .inflight
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if locks.len() > 1024 {
            locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        }
        locks
            .entry(format!("{kind}:{id}"))
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// Loads a public page through the content graph. `Cached` serves a copy younger
    /// than `max_age_seconds` (recommendation recall, where a week-old related list is
    /// fine). `Network` always refetches because people are looking at the page; it
    /// still records the graph, and serves the last retained copy only when offline.
    async fn graph_page<T, F, Fut, E>(
        &self,
        kind: &str,
        id: &str,
        freshness: Freshness,
        max_age_seconds: i64,
        fetch: F,
        edges: E,
    ) -> AppResult<T>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: Future<Output = AppResult<T>>,
        E: FnOnce(&T) -> Vec<(String, YTItem)>,
    {
        if freshness == Freshness::Cached
            && let Ok(Some(page)) =
                music_content::get_cached(&self.pool, kind, id, max_age_seconds).await
        {
            record_public_cache_hit();
            return Ok(page);
        }
        let lock = self.lock_for(kind, id);
        let _guard = lock.lock().await;
        if freshness == Freshness::Cached
            && let Ok(Some(page)) =
                music_content::get_cached(&self.pool, kind, id, max_age_seconds).await
        {
            record_public_cache_hit();
            return Ok(page);
        }
        let page = match fetch().await {
            Ok(page) => page,
            Err(error) => {
                return match music_content::get_cached(
                    &self.pool,
                    kind,
                    id,
                    music_content::RETENTION_SECONDS,
                )
                .await
                {
                    Ok(Some(page)) => {
                        tracing::info!(kind, id, %error, "Serving retained music page after fetch failure");
                        record_public_cache_hit();
                        Ok(page)
                    }
                    _ => Err(error),
                };
            }
        };
        if let Err(error) = music_content::save(&self.pool, kind, id, &page, &edges(&page)).await {
            tracing::warn!(%error, kind, id, "Could not save public music content graph");
        }
        Ok(page)
    }

    // --- Browse -----------------------------------------------------------
    pub async fn home(&self, continuation: Option<&str>) -> AppResult<MusicHomePage> {
        self.client.music_home_page(continuation).await
    }
    pub async fn explore(&self) -> AppResult<ExplorePage> {
        self.client.music_explore_page().await
    }
    pub async fn charts(
        &self,
        continuation: Option<&str>,
        country: Option<&str>,
    ) -> AppResult<ChartsPage> {
        self.client.music_charts_page(continuation, country).await
    }
    pub async fn moods(&self) -> AppResult<Vec<MoodAndGenreItem>> {
        self.client.music_moods().await
    }
    pub async fn mood_groups(&self) -> AppResult<Vec<MoodAndGenreGroup>> {
        self.client.music_mood_groups().await
    }
    pub async fn new_releases(&self) -> AppResult<Vec<AlbumItem>> {
        self.client.music_new_releases().await
    }
    pub async fn mood_genre(
        &self,
        browse_id: &str,
        params: Option<&str>,
        continuation: Option<&str>,
    ) -> AppResult<MoodGenrePage> {
        self.client
            .music_mood_genre(browse_id, params, continuation)
            .await
    }

    // --- Search -----------------------------------------------------------
    pub async fn search(&self, query: &str, filter: &str) -> AppResult<MusicSearchResponse> {
        self.client.music_search(query, filter).await
    }
    pub async fn search_continuation(&self, token: &str) -> AppResult<MusicSearchResponse> {
        self.client.music_search_continuation(token).await
    }
    pub async fn search_summary(&self, query: &str) -> AppResult<SearchSummaryPage> {
        self.client.music_search_summary(query).await
    }
    pub async fn search_suggestions(&self, query: &str) -> AppResult<MusicSearchSuggestions> {
        self.client.music_search_suggestions(query).await
    }

    // --- Album / Artist / Playlist ---------------------------------------
    pub async fn album(&self, browse_id: &str, freshness: Freshness) -> AppResult<AlbumPage> {
        self.graph_page(
            "album",
            browse_id,
            freshness,
            ALBUM_MAX_AGE_SECONDS,
            || self.client.music_album_page(browse_id),
            |page| track_edges(&page.songs),
        )
        .await
    }
    pub async fn album_continuation(
        &self,
        token: &str,
    ) -> AppResult<(Vec<SongItem>, Option<String>)> {
        self.client.music_album_continuation(token).await
    }
    pub async fn artist(&self, browse_id: &str, freshness: Freshness) -> AppResult<ArtistPage> {
        self.graph_page(
            "artist",
            browse_id,
            freshness,
            PAGE_MAX_AGE_SECONDS,
            || self.client.music_artist_page(browse_id),
            artist_edges,
        )
        .await
    }
    pub async fn playlist(
        &self,
        playlist_id: &str,
        freshness: Freshness,
    ) -> AppResult<MusicPlaylistPage> {
        self.graph_page(
            "playlist",
            playlist_id,
            freshness,
            PAGE_MAX_AGE_SECONDS,
            || self.client.music_playlist_page(playlist_id),
            |page| track_edges(&page.songs),
        )
        .await
    }
    pub async fn playlist_continuation(
        &self,
        token: &str,
    ) -> AppResult<(Vec<SongItem>, Option<String>)> {
        self.client.music_playlist_continuation(token).await
    }

    // --- Watch / queue / lyrics ------------------------------------------
    pub async fn watch_queue(
        &self,
        video_id: Option<&str>,
        playlist_id: Option<&str>,
        params: Option<&str>,
    ) -> AppResult<QueuePage> {
        self.client
            .music_watch_queue(video_id, playlist_id, params)
            .await
    }
    pub async fn queue_continuation(&self, token: &str) -> AppResult<QueuePage> {
        self.client.music_queue_continuation(token).await
    }
    pub async fn get_queue(
        &self,
        video_ids: &[String],
        playlist_id: Option<&str>,
    ) -> AppResult<QueuePage> {
        self.client.music_get_queue(video_ids, playlist_id).await
    }
    /// Related shelves only feed recommendations, so they are always graph-first.
    pub async fn related(&self, video_id: &str) -> AppResult<RelatedPage> {
        self.graph_page(
            "related",
            video_id,
            Freshness::Cached,
            PAGE_MAX_AGE_SECONDS,
            || self.client.music_related_page(video_id),
            related_edges,
        )
        .await
    }
    pub async fn lyrics(&self, video_id: &str) -> AppResult<Option<String>> {
        self.client.music_lyrics_text(video_id).await
    }

    // --- Playback ---------------------------------------------------------
    pub async fn resolve_stream(
        &self,
        video_id: &str,
        audio_quality: MusicAudioQuality,
    ) -> AppResult<MusicStreamInfo> {
        self.client
            .resolve_music_stream(video_id, audio_quality)
            .await
    }
}
