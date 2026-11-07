import { SETTINGS } from "./settings/schema";
import { lyricsHttpGet, enc } from "./lyrics/http";
import { musicArtistKey, musicTitleKey } from "./musicVideoMatching";
import { profileStorage } from "./storage/profileStorage";
import { artistsText } from "./musicFormat";
import { searchMusicTyped } from "./api/music";
import { getSettingValue } from "../store/useAppSettingsStore";
import type { SongItem } from "../types/music";

/**
 * Album motion artwork for the music player, from the artwork service beside the BetterLyrics API.
 * Port of Android's AnimatedArtworkRepository: each album is asked about once and the answer is kept
 * for days. A row with no album, usually a music video, is asked about again under its song
 * version's album. Apple often has several releases of a song and the service can land on one with
 * no loop, so a remaining miss looks the song up in Apple's public search and asks about its other
 * releases.
 */

const ENDPOINT = "https://artwork.boidu.dev/";
const CATALOG_SEARCH = "https://itunes.apple.com/search";
const CATALOG_RESULTS = 25;
// Misses saved before other releases were searched are left behind, so those albums are asked again.
const CACHE_KEY = "flow_animated_artwork_v2";
const OLD_CACHE_KEY = "flow_animated_artwork";
const CACHE_LIMIT = 300;
const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;
const TOPIC_SUFFIX = /\s*-\s*Topic$/i;
const UNKNOWN_ALBUM = "unknown album";
const ATV = "MUSIC_VIDEO_TYPE_ATV";
const VARIOUS_ARTISTS = "various artists";
const SINGLE_SUFFIX = "- Single";
const MAX_OTHER_RELEASES = 2;
const VERSION_RELEASE = /\b(remix|mix|lofi|lo-fi|flip|synthwave|instrumental|karaoke|slowed|reverb|sped up|nightcore)\b/i;
const COMMON_RELEASE_WORDS = new Set([
  "the", "an", "of", "from", "ep", "single", "album", "deluxe", "edition", "version", "original", "motion",
  "picture", "soundtrack", "ost", "hindi", "tamil", "telugu", "songs", "hits", "best", "greatest", "music",
]);

interface ArtworkAnswer {
  name?: string | null;
  artist?: string | null;
  animated?: string | null;
  albumId?: string | null;
}

/** What Apple's public catalogue search answers: the songs found and the release each is on. */
export interface CatalogSong {
  trackName?: string | null;
  artistName?: string | null;
  collectionId?: number | null;
  collectionName?: string | null;
  collectionArtistName?: string | null;
  trackCount?: number | null;
}

interface CachedLoop {
  url: string | null;
  at: number;
}

const artistOf = (song: SongItem) => song.artists[0]?.name ?? artistsText(song.artists);

/** `song` without the "Unknown Album" some rows carry, so it isn't asked about as an album. */
export function withKnownAlbum(song: SongItem): SongItem {
  return song.album?.name.trim().toLowerCase() === UNKNOWN_ALBUM ? { ...song, album: null } : song;
}

/** A loop belongs to an album, so the songs of one album share a single lookup. */
export const artworkKey = (song: SongItem): string => {
  const known = withKnownAlbum(song);
  return `${musicArtistKey(artistOf(known))}|${musicTitleKey(known.album?.name || known.title)}`;
};

const baseTitle = (title: string): string => title.replace(BRACKETS, "").replace(FEATURING, "").trim();
const searchArtist = (song: SongItem): string => artistOf(song).replace(TOPIC_SUFFIX, "").trim();
const songSearch = (song: SongItem): string => `${baseTitle(song.title)} ${searchArtist(song)}`;

/**
 * `song` as the first real song row in `rows` that is the same song by the same artist. Video rows
 * are left out: only a song row's album is the one the song was released on.
 */
export function albumVersion(song: SongItem, rows: SongItem[]): SongItem | null {
  const row = rows.find(
    (candidate) =>
      candidate.musicVideoType === ATV &&
      !!candidate.album?.name.trim() &&
      acceptsAnswer(song, { name: candidate.title, artist: candidate.artists.map((a) => a.name).join(", ") }),
  );
  return row ? { ...song, title: row.title, album: row.album, duration: row.duration } : null;
}

const nameWords = (name: string): Set<string> =>
  new Set(musicTitleKey(name).split(" ").filter((word) => word.length >= 2 && !COMMON_RELEASE_WORDS.has(word)));

/**
 * The album ids worth asking about after the song's own album had no loop, best first. Only the
 * same song by the same artist counts, on a release named like the song or its album: a
 * compilation that happens to carry the song has its own artwork, which is worse than none.
 */
export function otherReleases(song: SongItem, songs: CatalogSong[], asked: Set<string>): string[] {
  const related = new Set([...nameWords(song.album?.name ?? ""), ...nameWords(song.title)]);
  const songIsAVersion = VERSION_RELEASE.test(song.title);
  const seen = new Set<string>();
  return songs
    .filter((s) => acceptsAnswer(song, { name: s.trackName, artist: s.artistName }))
    .filter((s) => s.collectionId != null && !asked.has(String(s.collectionId)))
    .filter((s) => (s.collectionArtistName ?? "").toLowerCase() !== VARIOUS_ARTISTS)
    .filter((s) => [...nameWords(s.collectionName ?? "")].some((word) => related.has(word)))
    .filter((s) => songIsAVersion || !VERSION_RELEASE.test(s.collectionName ?? ""))
    .filter((s) => {
      const id = String(s.collectionId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort(
      (a, b) =>
        Number((a.collectionName ?? "").endsWith(SINGLE_SUFFIX)) - Number((b.collectionName ?? "").endsWith(SINGLE_SUFFIX)) ||
        (b.trackCount ?? 0) - (a.trackCount ?? 0),
    )
    .map((s) => String(s.collectionId))
    .slice(0, MAX_OTHER_RELEASES);
}

/** The song as titled, then without brackets or featured artists, each asked for once. */
export function artworkQueries(song: SongItem): Array<{ title: string; artist: string }> {
  const artist = searchArtist(song);
  return [...new Set([song.title, baseTitle(song.title)])].filter(Boolean).map((title) => ({ title, artist }));
}

/** Only an answer naming the same song by the same artist counts: a near miss would put another record's artwork on this one. */
export function acceptsAnswer(song: SongItem, answer: { name?: string | null; artist?: string | null }): boolean {
  if (!answer.name || !answer.artist) return false;
  const artists = song.artists.map((artist) => artist.name);
  return (
    musicTitleKey(answer.name, artists) === musicTitleKey(song.title, artists) &&
    musicArtistKey(answer.artist).includes(musicArtistKey(artistOf(song)))
  );
}

let oldCacheDropped = false;

function readCache(): Record<string, CachedLoop> {
  if (!oldCacheDropped) {
    oldCacheDropped = true;
    try {
      profileStorage.removeItem(OLD_CACHE_KEY, "device");
    } catch {
      // Only space; nothing reads it.
    }
  }
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

const storefront = () => String(getSettingValue(SETTINGS.TRENDING_REGION)).toLowerCase();

async function getJson<T>(url: string): Promise<T> {
  const response = await lyricsHttpGet(url);
  if (response.status < 200 || response.status >= 300) throw new Error(`Artwork service answered ${response.status}`);
  return JSON.parse(response.body) as T;
}

async function ask(song: SongItem, asked: Set<string>): Promise<string | null> {
  for (const query of artworkQueries(song)) {
    const params = [
      `s=${enc(query.title)}`,
      `a=${enc(query.artist)}`,
      song.album?.name ? `al=${enc(song.album.name)}` : "",
      song.duration ? `d=${song.duration}` : "",
      `storefront=${enc(storefront())}`,
    ].filter(Boolean);
    const answer = await getJson<ArtworkAnswer>(`${ENDPOINT}?${params.join("&")}`);
    if (acceptsAnswer(song, answer)) {
      if (answer.albumId) asked.add(answer.albumId);
      return answer.animated ?? null;
    }
  }
  return null;
}

async function songVersion(song: SongItem): Promise<SongItem | null> {
  if (song.album?.name.trim()) return null;
  // A failed search must throw, not read as no rows: a miss is kept for days.
  const found = await searchMusicTyped(songSearch(song), "songs");
  const rows = found.sections.flatMap((section) => section.items).filter((item): item is Extract<typeof item, { type: "song" }> => item.type === "song");
  return albumVersion(song, rows);
}

async function askOtherReleases(song: SongItem, asked: Set<string>): Promise<string | null> {
  const country = storefront();
  const search = await getJson<{ results?: CatalogSong[] }>(
    `${CATALOG_SEARCH}?term=${enc(songSearch(song))}&entity=song&country=${enc(country)}&limit=${CATALOG_RESULTS}`,
  );
  for (const albumId of otherReleases(song, search.results ?? [], asked)) {
    const answer = await getJson<ArtworkAnswer>(`${ENDPOINT}?id=${enc(albumId)}&storefront=${enc(country)}`);
    if (answer.animated) return answer.animated;
  }
  return null;
}

async function lookUp(song: SongItem): Promise<string | null> {
  const asked = new Set<string>();
  const own = await ask(song, asked);
  if (own) return own;
  const version = await songVersion(song);
  const fromVersion = version ? await ask(version, asked) : null;
  if (fromVersion) return fromVersion;
  return askOtherReleases(version ?? song, asked);
}

/**
 * The HLS loop for a song's album, or null when it has none. Each album is asked about once and the
 * answer, loop or none, is kept for days, as the service asks of its clients. Throws when it can't answer.
 */
export async function artworkLoopFor(song: SongItem, now = Date.now()): Promise<string | null> {
  const known = withKnownAlbum(song);
  const key = artworkKey(known);
  const cached = readCache()[key];
  if (cached && now - cached.at < (cached.url ? FOUND_TTL_MS : MISSING_TTL_MS)) return cached.url;
  const url = await lookUp(known);
  writeCache(key, url, now);
  return url;
}
