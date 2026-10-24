import type { LyricsEntry, LyricsProvider, WordTimestamp } from "../types";
import { lyricsHttpGet, lyricsGetText, enc } from "../http";
import { parseTTMLToLyricsEntries } from "../ttmlParser";
import { parseLyrics } from "../lyricsUtils";
import { cleanArtist, cleanTitle } from "../matching";
import { UA_CHROME } from "./common";

const APPLE_BASE = "https://beta.music.apple.com";
const AMP_API = "https://amp-api.music.apple.com/v1/catalog/us";
const PAX_LYRICS = "https://lyrics.paxsenix.org/apple-music/lyrics";

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

interface AppleSong {
  id: string;
  attributes?: { name?: string; artistName?: string; albumName?: string; durationInMillis?: number };
}
interface AppleSearch {
  results?: { songs?: { data?: { id: string }[] } };
  resources?: { songs?: Record<string, AppleSong> };
}

function scoreSong(song: AppleSong, title: string, artist: string, durationMs: number): number {
  const a = song.attributes ?? {};
  const resTitle = cleanTitle(a.name ?? "").toLowerCase();
  const target = cleanTitle(title).toLowerCase();
  const resArtist = (a.artistName ?? "").toLowerCase();
  const targetArtist = cleanArtist(artist).toLowerCase();
  let score = 0;

  if (durationMs > 0 && a.durationInMillis) {
    const diff = Math.abs(a.durationInMillis - durationMs);
    score += diff <= 2000 ? 100 : diff <= 5000 ? 50 : diff <= 10000 ? 10 : -50;
  }
  if (resTitle === target) score += 80;
  else if (resTitle.includes(target) || target.includes(resTitle)) score += 40;
  if (resArtist.includes(targetArtist) && targetArtist) score += 50;
  else if (targetArtist.split(/\s+/).some((w) => w && resArtist.includes(w))) score += 25;
  if (/remix/.test(resTitle) && !/remix/.test(target)) score -= 40;
  return score;
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

async function searchSongs(title: string, artist: string, durationMs: number): Promise<AppleSong[]> {
  const term = `${cleanTitle(title)} ${cleanArtist(artist)}`.trim();
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

  const data = JSON.parse(res.body) as AppleSearch;
  const ids = data.results?.songs?.data?.map((d) => d.id) ?? [];
  const resources = data.resources?.songs ?? {};
  const songs = ids.map((id) => resources[id]).filter((s): s is AppleSong => !!s);
  return songs
    .map((s) => ({ s, score: scoreSong(s, title, artist, durationMs) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 10)
    .map((x) => x.s);
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

export const paxsenixProvider: LyricsProvider = {
  name: "Paxsenix",
  async getLyrics(_id, title, artist, durationSec): Promise<LyricsEntry[]> {
    const songs = await searchSongs(title, artist, durationSec * 1000);
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
        if (bestQuality === 3) break; // word-sync — good enough
      } catch {
        /* try next candidate */
      }
    }
    return best;
  },
};
