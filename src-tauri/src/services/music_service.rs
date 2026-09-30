//! Thin service over the concrete [`InnertubeClient`] exposing the additive
//! YouTube Music surface. Kept separate from [`crate::services::youtube_service`]
//! (which is a `dyn YoutubeExtractor` and drives the video path) so the music
//! feature is independently wired and the video path is untouched.

use std::collections::{HashMap, HashSet};
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
const TRENDING_MAX_AGE_SECONDS: i64 = 6 * 60 * 60;
/// The anonymous home spreads its song shelves over the first few pages.
const TRENDING_HOME_PAGES: usize = 3;

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

fn is_audio(song: &SongItem) -> bool {
    song.music_video_type
        .as_deref()
        .is_none_or(|kind| kind == "MUSIC_VIDEO_TYPE_ATV")
}

/// Audio songs from any mix of items, first occurrence wins.
fn audio_songs<'a>(items: impl Iterator<Item = &'a YTItem>) -> Vec<SongItem> {
    let mut seen = HashSet::new();
    items
        .filter_map(|item| match item {
            YTItem::Song(song) if is_audio(song) => Some(song),
            _ => None,
        })
        .filter(|song| seen.insert(song.video_id.clone().unwrap_or_else(|| song.id.clone())))
        .cloned()
        .collect()
}

fn chart_songs(charts: &ChartsPage) -> Vec<SongItem> {
    audio_songs(
        charts
            .sections
            .iter()
            .filter(|section| section.chart_type == "Songs")
            .flat_map(|section| section.items.iter()),
    )
}

fn album_track_edges(page: &AlbumPage) -> Vec<(String, YTItem)> {
    page.songs
        .iter()
        .cloned()
        .map(|mut song| {
            music_content::fill_from_album(&mut song, &page.album);
            ("tracks".into(), YTItem::Song(song))
        })
        .collect()
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

/// Where a public page lives in the content graph and when a copy of it is worth using.
struct GraphSource<'a, T> {
    kind: &'a str,
    id: &'a str,
    max_age_seconds: i64,
    /// Rejects answers that must not be cached or served (e.g. an empty related page).
    usable: fn(&T) -> bool,
}

const fn always<T>(_: &T) -> bool {
    true
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
    /// A cached copy younger than `max_age_seconds` that `usable` accepts.
    async fn cached_copy<T: DeserializeOwned>(
        &self,
        kind: &str,
        id: &str,
        max_age_seconds: i64,
        usable: fn(&T) -> bool,
    ) -> Option<T> {
        match music_content::get_cached::<T>(&self.pool, kind, id, max_age_seconds).await {
            Ok(Some(page)) if usable(&page) => {
                record_public_cache_hit();
                Some(page)
            }
            _ => None,
        }
    }

    async fn graph_page<T, F, Fut, E>(
        &self,
        source: GraphSource<'_, T>,
        freshness: Freshness,
        fetch: F,
        edges: E,
    ) -> AppResult<T>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: Future<Output = AppResult<T>>,
        E: FnOnce(&T) -> Vec<(String, YTItem)>,
    {
        let GraphSource {
            kind,
            id,
            max_age_seconds,
            usable,
        } = source;
        if freshness == Freshness::Cached
            && let Some(page) = self.cached_copy(kind, id, max_age_seconds, usable).await
        {
            return Ok(page);
        }
        let lock = self.lock_for(kind, id);
        let _guard = lock.lock().await;
        if freshness == Freshness::Cached
            && let Some(page) = self.cached_copy(kind, id, max_age_seconds, usable).await
        {
            return Ok(page);
        }
        let page = match fetch().await {
            Ok(page) => page,
            Err(error) => {
                return match self
                    .cached_copy(kind, id, music_content::RETENTION_SECONDS, usable)
                    .await
                {
                    Some(page) => {
                        tracing::info!(kind, id, %error, "Serving retained music page after fetch failure");
                        Ok(page)
                    }
                    None => Err(error),
                };
            }
        };
        // An empty answer (a parsing miss or a transient gap) is returned but never kept,
        // so it cannot shadow real data for the whole cache lifetime.
        if usable(&page)
            && let Err(error) =
                music_content::save(&self.pool, kind, id, &page, &edges(&page)).await
        {
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
    /// Popular songs right now. Anonymous charts usually carry only video, genre and
    /// artist charts, so, as on Android, the songs `YouTube Music` puts on its own home
    /// stand in when there is no song chart. Cached for a few hours.
    pub async fn trending_songs(&self, country: Option<&str>) -> AppResult<Vec<SongItem>> {
        self.graph_page(
            GraphSource {
                kind: "trending",
                id: country.unwrap_or("global"),
                max_age_seconds: TRENDING_MAX_AGE_SECONDS,
                usable: |songs: &Vec<SongItem>| !songs.is_empty(),
            },
            Freshness::Cached,
            || self.fetch_trending(country),
            |_| Vec::new(),
        )
        .await
    }

    async fn fetch_trending(&self, country: Option<&str>) -> AppResult<Vec<SongItem>> {
        if let Ok(charts) = self.client.music_charts_page(None, country).await {
            let songs = chart_songs(&charts);
            if !songs.is_empty() {
                return Ok(songs);
            }
        }
        let mut shelves = Vec::new();
        let mut continuation: Option<String> = None;
        for _ in 0..TRENDING_HOME_PAGES {
            match self.client.music_home_page(continuation.as_deref()).await {
                Ok(page) => {
                    shelves.extend(page.sections);
                    continuation = page.continuation;
                }
                Err(error) if shelves.is_empty() => return Err(error),
                Err(_) => break,
            }
            if continuation.is_none() {
                break;
            }
        }
        Ok(audio_songs(
            shelves.iter().flat_map(|shelf| shelf.items.iter()),
        ))
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
            GraphSource {
                kind: "album",
                id: browse_id,
                max_age_seconds: ALBUM_MAX_AGE_SECONDS,
                usable: always,
            },
            freshness,
            || self.client.music_album_page(browse_id),
            album_track_edges,
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
            GraphSource {
                kind: "artist",
                id: browse_id,
                max_age_seconds: PAGE_MAX_AGE_SECONDS,
                usable: always,
            },
            freshness,
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
            GraphSource {
                kind: "playlist",
                id: playlist_id,
                max_age_seconds: PAGE_MAX_AGE_SECONDS,
                usable: always,
            },
            freshness,
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
            GraphSource {
                kind: "related",
                id: video_id,
                max_age_seconds: PAGE_MAX_AGE_SECONDS,
                usable: |page: &RelatedPage| !page.sections.is_empty(),
            },
            Freshness::Cached,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::music::{ArtistItem, ChartSection};

    fn song(id: &str, kind: Option<&str>) -> YTItem {
        YTItem::Song(SongItem {
            id: id.into(),
            title: id.into(),
            artists: Vec::new(),
            album: None,
            duration: Some(200),
            music_video_type: kind.map(Into::into),
            thumbnail: String::new(),
            explicit: false,
            video_id: Some(id.into()),
            playlist_id: None,
            params: None,
            views_text: None,
        })
    }

    fn ids(songs: &[SongItem]) -> Vec<&str> {
        songs.iter().map(|song| song.id.as_str()).collect()
    }

    #[test]
    fn chart_songs_keep_audio_from_song_charts_only() {
        let charts = ChartsPage {
            sections: vec![
                ChartSection {
                    title: "Top artists".into(),
                    chart_type: "Artists".into(),
                    items: vec![YTItem::Artist(ArtistItem {
                        id: "UC".into(),
                        title: "A".into(),
                        thumbnail: None,
                        channel_id: None,
                    })],
                },
                ChartSection {
                    title: "Top songs".into(),
                    chart_type: "Songs".into(),
                    items: vec![
                        song("audio", Some("MUSIC_VIDEO_TYPE_ATV")),
                        song("video", Some("MUSIC_VIDEO_TYPE_OMV")),
                        song("audio", Some("MUSIC_VIDEO_TYPE_ATV")),
                        song("untyped", None),
                    ],
                },
            ],
            country_code: None,
            country_label: None,
            continuation: None,
        };
        assert_eq!(ids(&chart_songs(&charts)), vec!["audio", "untyped"]);
    }

    #[test]
    fn charts_without_a_song_chart_yield_nothing() {
        let charts = ChartsPage {
            sections: vec![ChartSection {
                title: "Video charts".into(),
                chart_type: "Playlists".into(),
                items: Vec::new(),
            }],
            country_code: Some("US".into()),
            country_label: Some("United States".into()),
            continuation: None,
        };
        assert!(chart_songs(&charts).is_empty());
    }
}
