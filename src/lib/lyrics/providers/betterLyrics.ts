import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsHttpGet, enc } from "../http";
import { parseTTMLToLyricsEntries } from "../ttmlParser";
import { UA_CHROME } from "./common";

const BASE = "https://lyrics-api.boidu.dev";

/**
 * Songs nobody has looked up yet answer 401 "Uncached queries require a valid API key". That is a
 * miss for this song, not a refused client, so it must not bench the provider.
 */
export function isUncachedMiss(status: number, body: string): boolean {
  return status === 401 && /uncached/i.test(body);
}

export const betterLyricsProvider: LyricsProvider = {
  name: "BetterLyrics",
  async getLyrics(_id, title, artist, durationSec, album): Promise<LyricsEntry[]> {
    let url = `${BASE}/getLyrics?s=${enc(title)}&a=${enc(artist)}`;
    if (album) url += `&al=${enc(album)}`;
    if (durationSec > 0) url += `&d=${durationSec}`;

    const res = await lyricsHttpGet(url, { "User-Agent": UA_CHROME, Accept: "application/json" });
    if (isUncachedMiss(res.status, res.body)) return [];
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);

    let ttml = "";
    try {
      ttml = (JSON.parse(res.body) as { ttml?: string }).ttml ?? "";
    } catch {
      if (res.body.includes("<tt") || res.body.includes("<p ")) ttml = res.body;
    }
    return ttml ? parseTTMLToLyricsEntries(ttml) : [];
  },
};
