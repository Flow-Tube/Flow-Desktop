import type { CreditedLyrics, LyricsEntry, LyricsProvider } from "../types";
import { getMusicLyricsTyped } from "../../api/music";

/**
 * YouTube Music's own lyrics, asked for by video id, so they can't belong to another song. Song
 * rows have timed lines. Music video rows have none, and fall back to the Lyrics tab's plain text.
 */
export const youtubeProvider: LyricsProvider = {
  name: "YouTube",
  async getLyrics(id): Promise<CreditedLyrics> {
    if (!id) return { entries: [], source: null };
    const lyrics = await getMusicLyricsTyped(id);
    if (!lyrics?.text.trim()) return { entries: [], source: null };
    const entries: LyricsEntry[] = lyrics.timedLines.length > 0
      ? lyrics.timedLines.map((line) => ({ time: line.startMs, text: line.text }))
      : [{ time: 0, text: lyrics.text }];
    return { entries, source: lyrics.source };
  },
};
