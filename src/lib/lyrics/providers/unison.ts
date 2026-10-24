import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsHttpGet, enc } from "../http";
import { parseTTMLToLyricsEntries } from "../ttmlParser";
import { parseLyrics } from "../lyricsUtils";
import { flowUserAgent } from "./common";

const LYRICS_URL = "https://unison.boidu.dev/lyrics";

interface UnisonResponse {
  success?: boolean;
  data?: { lyrics?: string | null; format?: string | null; syncType?: string | null } | null;
}

/** Each entry says whether it is Apple-style TTML, LRC (word stamps included) or plain text. */
export function parseUnison(body: string): LyricsEntry[] {
  const response = JSON.parse(body) as UnisonResponse;
  const entry = response.success === true ? response.data : null;
  const text = entry?.lyrics;
  if (!text?.trim()) return [];
  if (entry?.format?.toLowerCase() === "ttml") return parseTTMLToLyricsEntries(text);
  if (entry?.syncType?.toLowerCase() === "plain") return [{ time: 0, text: text.trim() }];
  return parseLyrics(text);
}

/**
 * Unison: lyrics people submit themselves, so its catalogue is small and uneven, but it sometimes
 * has a song the licensed sources lack.
 */
export const unisonProvider: LyricsProvider = {
  name: "Unison",
  async getLyrics(_id, title, artist, durationSec, album): Promise<LyricsEntry[]> {
    if (!title.trim() || !artist.trim()) return [];
    let url = `${LYRICS_URL}?song=${enc(title)}&artist=${enc(artist)}`;
    if (album?.trim()) url += `&album=${enc(album)}`;
    if (durationSec > 0) url += `&duration=${durationSec}`;
    const res = await lyricsHttpGet(url, { "User-Agent": await flowUserAgent(), Accept: "application/json" });
    return res.status >= 200 && res.status < 300 ? parseUnison(res.body) : [];
  },
};
