// Typed Tauri command wrappers for the YouTube Music subsystem.
// Mirrors the style of `youtube.ts`; every function maps 1:1 to a
// `#[tauri::command]` in `src-tauri/src/commands/music.rs`.

import { isDeepFlowCurrentlyActive } from "../deepFlow";
import { invokeBackend } from "./errors";
import type {
  AlbumItem,
  AlbumPage,
  ArtistItem,
  ArtistPage,
  CachedMusicHomePage,
  ChartsPage,
  DailyMixSeed,
  ExplorePage,
  MoodAndGenreItem,
  MoodAndGenreGroup,
  MoodGenrePage,
  MusicHomePage,
  MusicTimeRotation,
  MusicPlaylistPage,
  MusicSearchResponse,
  MusicSearchSuggestions,
  MusicStreamInfo,
  MusicTasteProfile,
  QueuePage,
  RelatedPage,
  SearchSummaryPage,
  SongContinuation,
  SongItem,
} from "../../types/music";

export type MusicAudioQuality = "Auto" | "High" | "Medium" | "Low";

// --- Browse ---------------------------------------------------------------

export function getMusicHomePage(continuation?: string): Promise<MusicHomePage> {
  return invokeBackend<MusicHomePage>("get_music_home_page", { continuation });
}

export function getCachedMusicHomePage(): Promise<CachedMusicHomePage | null> {
  return invokeBackend<CachedMusicHomePage | null>("get_cached_music_home_page");
}

export interface MusicRequestDiagnostics {
  requests: number;
  requestMillis: number;
  publicCacheHits: number;
}

export function getMusicRequestDiagnostics(): Promise<MusicRequestDiagnostics> {
  return invokeBackend<MusicRequestDiagnostics>("get_music_request_diagnostics");
}

/**
 * Page fetch mode. Pages people open are always fetched fresh; recommendation
 * recall passes `preferCached` so the content graph can answer without a request.
 */
export interface MusicPageOptions {
  preferCached?: boolean;
}

export function getMusicExplorePage(): Promise<ExplorePage> {
  return invokeBackend<ExplorePage>("get_music_explore_page");
}

const chartRequests = new Map<string, Promise<ChartsPage>>();

export function getMusicChartsPage(continuation?: string, country?: string): Promise<ChartsPage> {
  const key = `${country ?? ''}:${continuation ?? ''}`;
  const existing = chartRequests.get(key);
  if (existing) return existing;
  const request = invokeBackend<ChartsPage>("get_music_charts_page", { continuation, country });
  chartRequests.set(key, request);
  void request.then(
    () => { if (chartRequests.get(key) === request) chartRequests.delete(key); },
    () => { if (chartRequests.get(key) === request) chartRequests.delete(key); },
  );
  return request;
}

export function getMusicTrendingSongs(country?: string): Promise<SongItem[]> {
  return invokeBackend<SongItem[]>("get_music_trending_songs", { country });
}

export function getMusicMoods(): Promise<MoodAndGenreItem[]> {
  return invokeBackend<MoodAndGenreItem[]>("get_music_moods");
}

export function getMusicMoodGroups(): Promise<MoodAndGenreGroup[]> {
  return invokeBackend<MoodAndGenreGroup[]>("get_music_mood_groups");
}

export function getMusicNewReleases(): Promise<AlbumItem[]> {
  return invokeBackend<AlbumItem[]>("get_music_new_releases");
}

export function getMusicMoodGenre(
  browseId: string,
  params?: string,
  continuation?: string,
): Promise<MoodGenrePage> {
  return invokeBackend<MoodGenrePage>("get_music_mood_genre", { browseId, params, continuation });
}

export function getMusicArtistItems(
  browseId: string,
  params?: string,
  continuation?: string,
): Promise<MoodGenrePage> {
  return invokeBackend<MoodGenrePage>("get_music_artist_items", { browseId, params, continuation });
}

// --- Search ---------------------------------------------------------------

export function searchMusicTyped(query: string, filter = ""): Promise<MusicSearchResponse> {
  return invokeBackend<MusicSearchResponse>("search_music_typed", { query, filter });
}

export function searchMusicContinuation(continuation: string): Promise<MusicSearchResponse> {
  return invokeBackend<MusicSearchResponse>("search_music_continuation", { continuation });
}

export function getMusicSearchSummary(query: string): Promise<SearchSummaryPage> {
  return invokeBackend<SearchSummaryPage>("get_music_search_summary", { query });
}

export function getMusicSearchSuggestions(query: string): Promise<MusicSearchSuggestions> {
  return invokeBackend<MusicSearchSuggestions>("get_music_search_suggestions", { query });
}

// --- Album / Artist / Playlist -------------------------------------------

export function getMusicAlbumPage(browseId: string, options: MusicPageOptions = {}): Promise<AlbumPage> {
  return invokeBackend<AlbumPage>("get_music_album_page", { browseId, preferCached: options.preferCached });
}

export function getMusicAlbumContinuation(continuation: string): Promise<SongContinuation> {
  return invokeBackend<SongContinuation>("get_music_album_continuation", { continuation });
}

export function getMusicArtistPage(browseId: string, options: MusicPageOptions = {}): Promise<ArtistPage> {
  return invokeBackend<ArtistPage>("get_music_artist_page", { browseId, preferCached: options.preferCached });
}

export function getMusicPlaylistPage(
  playlistId: string,
  options: MusicPageOptions = {},
): Promise<MusicPlaylistPage> {
  return invokeBackend<MusicPlaylistPage>("get_music_playlist_page", {
    playlistId,
    preferCached: options.preferCached,
  });
}

export function getMusicPlaylistContinuation(continuation: string): Promise<SongContinuation> {
  return invokeBackend<SongContinuation>("get_music_playlist_continuation", { continuation });
}

// --- Watch / queue / lyrics ----------------------------------------------

export function getMusicWatchQueue(
  videoId?: string,
  playlistId?: string,
  params?: string,
): Promise<QueuePage> {
  return invokeBackend<QueuePage>("get_music_watch_queue", { videoId, playlistId, params });
}

export function getMusicQueueContinuation(continuation: string): Promise<QueuePage> {
  return invokeBackend<QueuePage>("get_music_queue_continuation", { continuation });
}

export function getMusicQueue(videoIds: string[], playlistId?: string): Promise<QueuePage> {
  return invokeBackend<QueuePage>("get_music_queue", { videoIds, playlistId });
}

export function getMusicRelatedTyped(videoId: string): Promise<RelatedPage> {
  return invokeBackend<RelatedPage>("get_music_related_typed", { videoId });
}

export function getMusicDeepCuts(limit = 20): Promise<SongItem[]> {
  return invokeBackend<SongItem[]>("get_music_deep_cuts", { limit });
}

export function getMusicRediscover(limit = 16): Promise<SongItem[]> {
  return invokeBackend<SongItem[]>("get_music_rediscover", { limit });
}

export function getMusicTimeRotation(limit = 20): Promise<MusicTimeRotation> {
  return invokeBackend<MusicTimeRotation>("get_music_time_rotation", { limit });
}

export function getMusicLinkedArtists(limit = 20): Promise<ArtistItem[]> {
  return invokeBackend<ArtistItem[]>("get_music_linked_artists", { limit });
}

export function getMusicLyricsTyped(videoId: string): Promise<string | null> {
  return invokeBackend<string | null>("get_music_lyrics_typed", { videoId });
}

// --- Playback -------------------------------------------------------------

/**
 * Resolve a proxied, playable audio stream for a music track. The returned
 * `audioUrl` is already a local proxy URL (`http://127.0.0.1:{port}/stream/…`)
 * — feed it straight to an `<audio>` element. `loudnessDb` is for volume
 * normalization.
 */
export function getMusicStream(
  videoId: string,
  audioQuality: MusicAudioQuality = "Auto",
): Promise<MusicStreamInfo> {
  return invokeBackend<MusicStreamInfo>("get_music_stream", { videoId, audioQuality });
}

// --- Music brain (dedicated, entity-based; separate from the video engine) -----

export async function recordMusicInteraction(params: {
  trackId: string;
  artistId?: string | null;
  artistName: string;
  title?: string | null;
  thumbnail?: string | null;
  genre?: string | null;
  percentPlayed: number;
  isExplicitLike?: boolean;
}): Promise<void> {
  if (isDeepFlowCurrentlyActive()) return;
  return invokeBackend<void>("record_music_interaction", {
    trackId: params.trackId,
    artistId: params.artistId ?? null,
    artistName: params.artistName,
    title: params.title ?? null,
    thumbnail: params.thumbnail ?? null,
    genre: params.genre ?? null,
    percentPlayed: params.percentPlayed,
    isExplicitLike: params.isExplicitLike ?? false,
  });
}

/**
 * The "On Repeat" tracks — what they currently play most (ACT-R activation),
 * resolved to playable songs entirely from local state (no network). Empty until there
 * is enough listening history.
 */
export function getHeavyRotation(limit = 16): Promise<SongItem[]> {
  return invokeBackend<SongItem[]>("get_heavy_rotation", { limit });
}

/**
 * Daily Mix clusters from the music brain (favorite artists grouped by co-listening).
 * Each is a label + seed track ids the caller expands into a playlist via related songs.
 * Empty until there's enough cross-session listening to form a co-occurrence graph.
 */
export function getDailyMixes(maxMixes = 3): Promise<DailyMixSeed[]> {
  return invokeBackend<DailyMixSeed[]>("get_daily_mixes", { maxMixes });
}

/** Surfaces with distinct familiarity/discovery weighting in the music ranker. */
export type MusicRankSurface =
  | "quick_picks"
  | "heavy_rotation"
  | "radio"
  | "similar"
  | "discover"
  | "daily_discover";

/**
 * Reorder YouTube Music candidates by local taste. YT Music is the recall engine; this
 * is the local ranking stage that makes a generic shelf personal. A cold/empty brain is
 * a stable pass-through (returns the input order), so it is always safe to call.
 */
export function rankMusicCandidates(
  songs: SongItem[],
  surface: MusicRankSurface,
): Promise<SongItem[]> {
  return invokeBackend<SongItem[]>("rank_music_candidates", { songs, surface });
}

/** Records a reversible dislike cooldown for an artist (a repeat dislike escalates to a block). */
export function dislikeMusicArtist(artistId: string | null, artistName: string): Promise<void> {
  return invokeBackend<void>("dislike_music_artist", { artistId, artistName });
}

/** Hard-blocks an artist ("don't recommend") — a permanent denylist across all music surfaces. */
export function blockMusicArtist(artistId: string | null, artistName: string): Promise<void> {
  return invokeBackend<void>("block_music_artist", { artistId, artistName });
}

/** Lifts a hard block. `artistKey` is the resolved key from {@link getBlockedMusicArtists}. */
export function unblockMusicArtist(artistKey: string): Promise<void> {
  return invokeBackend<void>("unblock_music_artist", { artistKey });
}

/** The resolved keys of all hard-blocked artists (id, or normalized name). */
export function getBlockedMusicArtists(): Promise<string[]> {
  return invokeBackend<string[]>("get_blocked_music_artists");
}

/** Clears all learned music taste (and re-enables history backfill on next launch). */
export function resetMusicBrain(): Promise<void> {
  return invokeBackend<void>("reset_music_brain");
}

export function getMusicTasteProfile(): Promise<MusicTasteProfile> {
  return invokeBackend<MusicTasteProfile>("get_music_taste_profile");
}
