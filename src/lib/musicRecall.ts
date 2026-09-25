// Shared candidate-recall helpers for the music home: audio filtering, claiming,
// ranking and graph-first page reads. Every function degrades to an empty or
// unranked result instead of throwing, so one failed source never breaks a shelf.
import {
  getMusicArtistPage,
  getMusicChartsPage,
  getMusicRelatedTyped,
  rankMusicCandidates,
  type MusicRankSurface,
} from './api/music';
import { segmentArtistPage, type ArtistPageData } from './useArtistPage';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import { SETTINGS } from './settings/schema';
import type { AlbumItem, SongItem, YTItem } from '../types/music';

export const MIN_SHELF_ITEMS = 4;

export const songIdOf = (song: SongItem): string => song.videoId ?? song.id;
export const toYTSong = (song: SongItem): YTItem => ({ type: 'song', ...song });

export function ytItemId(item: YTItem): string {
  if ('videoId' in item && item.videoId) return item.videoId;
  if ('id' in item && item.id) return item.id;
  if ('browseId' in item && item.browseId) return item.browseId;
  return '';
}

export function isAudioSong(song: SongItem): boolean {
  const type = song.musicVideoType;
  const isVideo = !!type && type !== 'MUSIC_VIDEO_TYPE_ATV';
  const duration = song.duration ?? 0;
  const plausibleLength = duration === 0 || (duration >= 30 && duration <= 1200);
  return !isVideo && !!songIdOf(song) && plausibleLength;
}

export function audioMusicOnly(songs: SongItem[]): SongItem[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    if (!isAudioSong(song)) return false;
    const id = songIdOf(song);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Up to `n` songs not yet claimed by `used` (mutated) nor in the read-only `avoid` set. */
export function takeUnused(songs: SongItem[], n: number, used: Set<string>, avoid?: Set<string>): SongItem[] {
  const out: SongItem[] = [];
  for (const song of songs) {
    const id = songIdOf(song);
    if (!id || used.has(id) || avoid?.has(id)) continue;
    used.add(id);
    out.push(song);
    if (out.length >= n) break;
  }
  return out;
}

/** Fisher–Yates; `sort(() => Math.random() - 0.5)` is biased toward the input order. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap] as T, out[index] as T];
  }
  return out;
}

/** Local taste ranking; a cold brain is a pass-through and failures keep recall order. */
export async function ranked(songs: SongItem[], surface: MusicRankSurface): Promise<SongItem[]> {
  if (songs.length <= 1) return songs;
  try {
    return await rankMusicCandidates(songs, surface);
  } catch {
    return songs;
  }
}

export async function relatedSongs(videoId: string): Promise<SongItem[]> {
  try {
    return audioMusicOnly((await getMusicRelatedTyped(videoId)).songs);
  } catch {
    return [];
  }
}

export function chartCountry(): string {
  return useAppSettingsStore.getState().values[SETTINGS.TRENDING_REGION] ?? 'US';
}

export async function chartsSongs(): Promise<SongItem[]> {
  try {
    const charts = await getMusicChartsPage(undefined, chartCountry());
    return audioMusicOnly(charts.sections
      .filter((section) => section.chartType === 'Songs')
      .flatMap((section) => section.items)
      .filter((item): item is Extract<YTItem, { type: 'song' }> => item.type === 'song'));
  } catch {
    return [];
  }
}

/** Artist details for recall, served from the content graph when it is fresh. */
export async function recallArtist(browseId: string): Promise<ArtistPageData | null> {
  try {
    return segmentArtistPage(await getMusicArtistPage(browseId, { preferCached: true }));
  } catch {
    return null;
  }
}

/** One release per artist per pass (newest first), so no artist owns the shelf. */
export function roundRobinReleases(perArtist: AlbumItem[][], limit: number): AlbumItem[] {
  const out: AlbumItem[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...perArtist.map((releases) => releases.length));
  for (let index = 0; index < depth && out.length < limit; index += 1) {
    for (const releases of perArtist) {
      const album = releases[index];
      if (!album?.browseId || seen.has(album.browseId)) continue;
      seen.add(album.browseId);
      out.push(album);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * A Similar to row that covers songs, artists and playlists: after the first two songs,
 * an artist or playlist card follows every second song (artists first), and any cards
 * left over when songs run out close the row.
 */
export function interleaveSimilar(songs: YTItem[], extras: YTItem[][]): YTItem[] {
  const queue: YTItem[] = [];
  for (let index = 0; index < Math.max(0, ...extras.map((list) => list.length)); index += 1) {
    for (const list of extras) {
      const extra = list[index];
      if (extra) queue.push(extra);
    }
  }
  const out: YTItem[] = [];
  songs.forEach((song, index) => {
    out.push(song);
    if (index >= 1 && index % 2 === 1 && queue.length) out.push(queue.shift() as YTItem);
  });
  return [...out, ...queue];
}
