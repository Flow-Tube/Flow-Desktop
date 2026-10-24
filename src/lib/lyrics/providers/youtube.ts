import type { CreditedLyrics, LyricsEntry, LyricsProvider } from "../types";
import { getMusicLyricsTyped } from "../../api/music";

export const youtubeSubtitleProvider: LyricsProvider = {
  name: "YouTubeSubtitle",
  async getLyrics(): Promise<LyricsEntry[]> {
    return [];
  },
};

export const youtubeProvider: LyricsProvider = {
  name: "YouTube",
  async getLyrics(id): Promise<CreditedLyrics> {
    if (!id) return { entries: [], source: null };
    const lyrics = await getMusicLyricsTyped(id);
    return lyrics?.text.trim()
      ? { entries: [{ time: 0, text: lyrics.text }], source: lyrics.source }
      : { entries: [], source: null };
  },
};
