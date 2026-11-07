import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsHttpGet, enc } from "../http";
import { parseLyrics } from "../lyricsUtils";
import { cleanArtist, ranked } from "../matching";

const API = "https://lrclib.net/api";
const HEADERS = { "User-Agent": "Flow Desktop (https://github.com/aedev/flow)" };

export interface LrcRecord {
  trackName?: string | null;
  artistName?: string | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  duration?: number | null;
}

function toEntries(rec: LrcRecord | null): LyricsEntry[] {
  if (!rec) return [];
  if (rec.syncedLyrics) {
    const entries = parseLyrics(rec.syncedLyrics);
    if (entries.length > 0) return entries;
  }
  return rec.plainLyrics ? [{ time: 0, text: rec.plainLyrics }] : [];
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await lyricsHttpGet(url, HEADERS);
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

const MAX_DURATION_GAP_SEC = 10;

/** A search returns whatever shares a word with the query, so only the same song may pass; synced files first. */
export function pickSearchHit(hits: LrcRecord[], title: string, artist: string, durationSec: number): LrcRecord | null {
  const matches = ranked(
    hits.filter((hit) => hit.duration == null || durationSec <= 0 || Math.abs(hit.duration - durationSec) <= MAX_DURATION_GAP_SEC),
    { title, artist, durationSec },
    (hit) => ({
      title: hit.trackName ?? "",
      artist: hit.artistName ?? "",
      durationSec: Math.round(hit.duration ?? 0),
    }),
  );
  return matches.find((hit) => hit.syncedLyrics) ?? matches[0] ?? null;
}

export const lrclibProvider: LyricsProvider = {
  name: "LrcLib",
  async getLyrics(_id, title, artist, durationSec): Promise<LyricsEntry[]> {
    const searchArtist = cleanArtist(artist);
    // /get is an exact catalogue lookup, so it is only worth a request with an artist to look up.
    if (searchArtist) {
      let url = `${API}/get?track_name=${enc(title)}&artist_name=${enc(searchArtist)}`;
      if (durationSec > 0) url += `&duration=${durationSec}`;
      const exact = toEntries(await getJson<LrcRecord>(url));
      if (exact.length > 0) return exact;
    }
    const hits = await getJson<LrcRecord[]>(`${API}/search?q=${enc(`${searchArtist} ${title}`.trim())}`);
    if (!Array.isArray(hits)) return [];
    return toEntries(pickSearchHit(hits, title, artist, durationSec));
  },
};
