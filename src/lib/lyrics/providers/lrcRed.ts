import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsHttpGet, enc } from "../http";
import { parseTTMLToLyricsEntries } from "../ttmlParser";
import { best, type MatchSong } from "../matching";
import { flowUserAgent } from "./common";

const SEARCH_URL = "https://lrc.red/api/v1";

export interface LrcRedHit {
  track_name?: string | null;
  artist_name?: string | null;
  duration?: number | null;
  timing_type?: string | null;
  lyricsUrl?: string | null;
}

export function parseLrcRedSearch(body: string): LrcRedHit[] {
  const parsed = JSON.parse(body) as { results?: LrcRedHit[] };
  return Array.isArray(parsed.results) ? parsed.results : [];
}

const isHttps = (url: string | null | undefined): boolean => {
  try {
    return !!url && new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** The same recording, word-timed files first; documents are only fetched over https. */
export function pickLrcRedHit(hits: LrcRedHit[], request: MatchSong): LrcRedHit | null {
  return best(
    hits.filter((hit) => isHttps(hit.lyricsUrl)),
    request,
    (hit) => ({ title: hit.track_name ?? "", artist: hit.artist_name ?? "", durationSec: hit.duration ?? 0 }),
    (hit) => hit.timing_type?.toLowerCase() === "word",
  );
}

async function get(url: string): Promise<string | null> {
  const res = await lyricsHttpGet(url, { "User-Agent": await flowUserAgent() });
  return res.status >= 200 && res.status < 300 && res.body.trim() ? res.body : null;
}

async function search(params: Array<[string, string]>): Promise<LrcRedHit[]> {
  const query = params.map(([key, value]) => `${key}=${enc(value)}`).join("&");
  const body = await get(`${SEARCH_URL}?${query}`);
  return body ? parseLrcRedSearch(body) : [];
}

/**
 * lrc.red: Apple Music word-synced TTML archived by ISRC. Its search names the recording behind
 * each hit, and the hit is checked against the request before its document is fetched.
 * `lyrics-api.binimum.org`, which LyricsPlus used to call first, now redirects here.
 */
export const lrcRedProvider: LyricsProvider = {
  name: "LrcRed",
  async getLyrics(_id, title, artist, durationSec, album): Promise<LyricsEntry[]> {
    const request: MatchSong = { title, artist, durationSec };
    const shaped: Array<[string, string]> = [["track", title]];
    if (artist.trim()) shaped.push(["artist", artist]);
    if (album?.trim()) shaped.push(["album", album]);
    if (durationSec > 0) shaped.push(["duration", String(durationSec)]);

    const hit =
      pickLrcRedHit(await search(shaped), request) ??
      pickLrcRedHit(await search([["q", artist.trim() ? `${artist} - ${title}` : title]]), request);
    if (!hit?.lyricsUrl) return [];
    const document = await get(hit.lyricsUrl);
    return document ? parseTTMLToLyricsEntries(document) : [];
  },
};
