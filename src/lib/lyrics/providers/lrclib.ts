import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsHttpGet, enc } from "../http";
import { parseLyrics } from "../lyricsUtils";
import { best } from "../matching";

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
  if (res.status < 200 || res.status >= 300) return null;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

/** The search hit naming the same recording, synced files first. */
export function pickSearchHit(hits: LrcRecord[], title: string, artist: string, durationSec: number): LrcRecord | null {
  return best(
    hits,
    { title, artist, durationSec },
    (hit) => ({
      title: hit.trackName ?? "",
      artist: hit.artistName ?? "",
      durationSec: Math.round(hit.duration ?? 0),
    }),
    (hit) => !!hit.syncedLyrics,
  );
}

export const lrclibProvider: LyricsProvider = {
  name: "LrcLib",
  async getLyrics(_id, title, artist, durationSec): Promise<LyricsEntry[]> {
    // /get is an exact catalogue lookup, so it is only worth a request with an artist to look up.
    if (artist) {
      let url = `${API}/get?track_name=${enc(title)}&artist_name=${enc(artist)}`;
      if (durationSec > 0) url += `&duration=${durationSec}`;
      const exact = toEntries(await getJson<LrcRecord>(url));
      if (exact.length > 0) return exact;
    }
    const hits = await getJson<LrcRecord[]>(`${API}/search?q=${enc(`${artist} ${title}`.trim())}`);
    if (!Array.isArray(hits)) return [];
    return toEntries(pickSearchHit(hits, title, artist, durationSec));
  },
};
