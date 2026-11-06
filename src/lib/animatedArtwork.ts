import { SETTINGS } from "./settings/schema";
import { lyricsHttpGet, enc } from "./lyrics/http";
import { musicArtistKey, musicTitleKey } from "./musicVideoMatching";
import { profileStorage } from "./storage/profileStorage";
import { artistsText } from "./musicFormat";
import { getSettingValue } from "../store/useAppSettingsStore";
import type { SongItem } from "../types/music";

const ENDPOINT = "https://artwork.boidu.dev/";
const CACHE_KEY = "flow_animated_artwork";
const CACHE_LIMIT = 300;
const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;
const TOPIC_SUFFIX = /\s*-\s*Topic$/i;

interface ArtworkAnswer {
  name?: string | null;
  artist?: string | null;
  animated?: string | null;
}

interface CachedLoop {
  url: string | null;
  at: number;
}

const artistOf = (song: SongItem) => song.artists[0]?.name ?? artistsText(song.artists);

/** A loop belongs to an album, so the songs of one album share a single lookup. */
export const artworkKey = (song: SongItem): string =>
  `${musicArtistKey(artistOf(song))}|${musicTitleKey(song.album?.name || song.title)}`;

/** The song as titled, then without brackets or featured artists, each asked for once. */
export function artworkQueries(song: SongItem): Array<{ title: string; artist: string }> {
  const artist = artistOf(song).replace(TOPIC_SUFFIX, "").trim();
  const base = song.title.replace(BRACKETS, "").replace(FEATURING, "").trim();
  return [...new Set([song.title, base])].filter(Boolean).map((title) => ({ title, artist }));
}

/** Only an answer naming the same song by the same artist counts: a near miss would put another record's artwork on this one. */
export function acceptsAnswer(song: SongItem, answer: ArtworkAnswer): boolean {
  if (!answer.name || !answer.artist) return false;
  const artists = song.artists.map((artist) => artist.name);
  return (
    musicTitleKey(answer.name, artists) === musicTitleKey(song.title, artists) &&
    musicArtistKey(answer.artist).includes(musicArtistKey(artistOf(song)))
  );
}

function readCache(): Record<string, CachedLoop> {
  try {
    const parsed: unknown = JSON.parse(profileStorage.getItem(CACHE_KEY, "device") ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, CachedLoop>) : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, url: string | null, now: number): void {
  try {
    const entries = Object.entries({ ...readCache(), [key]: { url, at: now } });
    const kept = entries.sort(([, a], [, b]) => b.at - a.at).slice(0, CACHE_LIMIT);
    profileStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(kept)), "device");
  } catch (error) {
    console.warn("Failed to remember animated artwork", error);
  }
}

/** Drops a song's answer, for a loop that no longer plays. */
export function forgetArtworkLoop(song: SongItem): void {
  try {
    const { [artworkKey(song)]: _dropped, ...rest } = readCache();
    profileStorage.setItem(CACHE_KEY, JSON.stringify(rest), "device");
  } catch (error) {
    console.warn("Failed to forget animated artwork", error);
  }
}

async function ask(song: SongItem): Promise<string | null> {
  const storefront = String(getSettingValue(SETTINGS.TRENDING_REGION)).toLowerCase();
  for (const query of artworkQueries(song)) {
    const params = [
      `s=${enc(query.title)}`,
      `a=${enc(query.artist)}`,
      song.album?.name ? `al=${enc(song.album.name)}` : "",
      song.duration ? `d=${song.duration}` : "",
      `storefront=${enc(storefront)}`,
    ].filter(Boolean);
    const response = await lyricsHttpGet(`${ENDPOINT}?${params.join("&")}`);
    if (response.status < 200 || response.status >= 300) throw new Error(`Artwork service answered ${response.status}`);
    const answer = JSON.parse(response.body) as ArtworkAnswer;
    if (acceptsAnswer(song, answer)) return answer.animated ?? null;
  }
  return null;
}

/**
 * The HLS loop for a song's album, or null when it has none. Each album is asked about once and the
 * answer, loop or none, is kept for days, as the service asks of its clients. Throws when it can't answer.
 */
export async function artworkLoopFor(song: SongItem, now = Date.now()): Promise<string | null> {
  const key = artworkKey(song);
  const cached = readCache()[key];
  if (cached && now - cached.at < (cached.url ? FOUND_TTL_MS : MISSING_TTL_MS)) return cached.url;
  const url = await ask(song);
  writeCache(key, url, now);
  return url;
}
