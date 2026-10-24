import type { LyricsEntry, LyricsProvider, WordTimestamp } from "../types";
import { lyricsHttpGet, lyricsGetText, enc } from "../http";
import { parseTTMLToLyricsEntries } from "../ttmlParser";
import { parseLyrics } from "../lyricsUtils";
import { ranked } from "../matching";
import { UA_CHROME } from "./common";

const APPLE_BASE = "https://beta.music.apple.com";
const AMP_API = "https://amp-api.music.apple.com/v1/catalog/us";
const ITUNES_SEARCH = "https://itunes.apple.com/search";
const PAX_LYRICS = "https://lyrics.paxsenix.org/apple-music/lyrics";
const MAX_CANDIDATES = 10;

let cachedToken: string | null = null;

async function fetchToken(force: boolean): Promise<string | null> {
  if (cachedToken && !force) return cachedToken;
  const html = await lyricsGetText(APPLE_BASE, { "User-Agent": UA_CHROME });
  const jsPath = html.match(/\/assets\/index~?[^"'/]+\.js/);
  if (!jsPath) return null;
  const js = await lyricsGetText(APPLE_BASE + jsPath[0], { "User-Agent": UA_CHROME });
  const tok = js.match(/eyJh[^"']+/);
  cachedToken = tok ? tok[0] : null;
  return cachedToken;
}

/** An Apple Music song, from either the public iTunes search or the web player's catalogue. */
export interface AppleSong {
  id: string;
  name: string;
  artist: string;
  durationSec: number;
}

interface AmpSong {
  attributes?: { name?: string; artistName?: string; durationInMillis?: number };
}
interface AmpSearch {
  results?: { songs?: { data?: { id: string }[] } };
  resources?: { songs?: Record<string, AmpSong> };
}
interface ItunesSearch {
  results?: { trackId?: number; trackName?: string; artistName?: string; trackTimeMillis?: number }[];
}

export function parseItunesSearch(body: string): AppleSong[] {
  const data = JSON.parse(body) as ItunesSearch;
  return (data.results ?? [])
    .filter((song) => (song.trackId ?? 0) > 0 && song.trackName?.trim())
    .map((song) => ({
      id: String(song.trackId),
      name: song.trackName ?? "",
      artist: song.artistName ?? "",
      durationSec: Math.floor((song.trackTimeMillis ?? 0) / 1000),
    }));
}

const SEARCH_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Origin: "https://music.apple.com",
  Referer: "https://music.apple.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.5",
  "x-apple-renewal": "true",
});

async function searchItunes(term: string): Promise<AppleSong[]> {
  const res = await lyricsHttpGet(
    `${ITUNES_SEARCH}?term=${enc(term)}&media=music&entity=song&limit=25`,
    { Accept: "application/json" },
  );
  return res.status >= 200 && res.status < 300 ? parseItunesSearch(res.body) : [];
}

async function searchCatalogue(term: string): Promise<AppleSong[]> {
  const url =
    `${AMP_API}/search?term=${enc(term)}&types=songs&limit=25&l=en-US&platform=web` +
    `&format%5Bresources%5D=map&include%5Bsongs%5D=artists&extend=artistUrl`;
  let token = await fetchToken(false);
  if (!token) return [];
  let res = await lyricsHttpGet(url, SEARCH_HEADERS(token));
  if (res.status === 401) {
    token = await fetchToken(true);
    if (!token) return [];
    res = await lyricsHttpGet(url, SEARCH_HEADERS(token));
  }
  if (res.status < 200 || res.status >= 300) return [];
  const data = JSON.parse(res.body) as AmpSearch;
  const resources = data.resources?.songs ?? {};
  return (data.results?.songs?.data ?? []).flatMap(({ id }) => {
    const attributes = resources[id]?.attributes;
    if (!attributes) return [];
    return [{
      id,
      name: attributes.name ?? "",
      artist: attributes.artistName ?? "",
      durationSec: Math.floor((attributes.durationInMillis ?? 0) / 1000),
    }];
  });
}

// The public iTunes search needs no token and finds the same Apple Music ids; the token scraped
// from Apple's web player is the fallback.
async function search(term: string): Promise<AppleSong[]> {
  const itunes = await searchItunes(term).catch(() => []);
  return itunes.length > 0 ? itunes : searchCatalogue(term).catch(() => []);
}

interface PaxLyrics {
  type?: string;
  content?: { timestamp: number; endtime: number; text?: { text: string; timestamp: number; endtime: number }[]; background?: boolean; oppositeTurn?: boolean }[];
  ttmlContent?: string;
  elrcMultiPerson?: string;
  elrc?: string;
  plain?: string;
}

function contentToEntries(content: NonNullable<PaxLyrics["content"]>): LyricsEntry[] {
  return content.map((line) => {
    const words: WordTimestamp[] = (line.text ?? []).map((w) => ({
      text: w.text,
      startTime: w.timestamp,
      endTime: w.endtime,
    }));
    return {
      time: line.timestamp,
      text: words.map((w) => w.text).join(" "),
      words: words.length ? words : null,
      agent: line.oppositeTurn ? "v2" : "v1",
      isBackground: !!line.background,
    };
  });
}

function lyricsQuality(entries: LyricsEntry[]): number {
  if (entries.some((e) => e.words && e.words.length > 0)) return 3;
  if (entries.some((e) => e.time > 0)) return 2;
  return entries.length ? 1 : 0;
}

async function fetchLyrics(appleId: string): Promise<LyricsEntry[]> {
  const res = await lyricsHttpGet(`${PAX_LYRICS}?id=${enc(appleId)}`, { "User-Agent": "Flow Desktop" });
  if (res.status < 200 || res.status >= 300) return [];
  const data = JSON.parse(res.body) as PaxLyrics;
  if (data.ttmlContent) return parseTTMLToLyricsEntries(data.ttmlContent);
  if (data.content && data.content.length) return contentToEntries(data.content);
  if (data.elrcMultiPerson) return parseLyrics(data.elrcMultiPerson);
  if (data.elrc) return parseLyrics(data.elrc);
  if (data.plain) return [{ time: 0, text: data.plain }];
  return [];
}

/** Songs naming the same recording, best first; a duration alone never makes a match. */
export function matchAppleSongs(songs: AppleSong[], title: string, artist: string, durationSec: number): AppleSong[] {
  return ranked(songs, { title, artist, durationSec }, (song) => ({
    title: song.name,
    artist: song.artist,
    durationSec: song.durationSec,
  })).slice(0, MAX_CANDIDATES);
}

export const paxsenixProvider: LyricsProvider = {
  name: "Paxsenix",
  async getLyrics(_id, title, artist, durationSec, album): Promise<LyricsEntry[]> {
    const terms = [`${title} ${artist}`.trim(), title];
    if (album) terms.push(`${title} ${artist} ${album}`.trim());
    let songs: AppleSong[] = [];
    for (const term of terms) {
      songs = matchAppleSongs(await search(term), title, artist, durationSec);
      if (songs.length > 0) break;
    }

    let best: LyricsEntry[] = [];
    let bestQuality = 0;
    for (const song of songs) {
      try {
        const entries = await fetchLyrics(song.id);
        const q = lyricsQuality(entries);
        if (q > bestQuality) {
          best = entries;
          bestQuality = q;
        }
        if (bestQuality === 3) break;
      } catch {
        // The next candidate may still have lyrics.
      }
    }
    return best;
  },
};
