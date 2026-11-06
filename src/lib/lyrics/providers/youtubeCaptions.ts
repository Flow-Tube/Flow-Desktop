import { getMusicCaptionsLrc } from "../../api/lyrics";
import { parseLyrics } from "../lyricsUtils";
import type { CreditedLyrics, LyricsProvider } from "../types";

export const youtubeCaptionsProvider: LyricsProvider = {
  name: "YouTubeSubtitle",
  async getLyrics(id): Promise<CreditedLyrics> {
    if (!id) return { entries: [], source: null };
    const lrc = await getMusicCaptionsLrc(id);
    return { entries: lrc ? parseLyrics(lrc) : [], source: null };
  },
};
