import type { LyricsEntry, LyricsProvider, WordTimestamp } from "../types";
import { lyricsGetJson, enc } from "../http";

// The other public mirrors (atomix.one, prjktla.my.id, lyricsplus-seven.vercel.app) were all down
// on Android's 2026-10-19 probe: no connection, 502 and DEPLOYMENT_DISABLED.
const SERVER = "https://lyricsplus.binimum.org";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

interface LpSyllable {
  time: number;
  duration: number;
  text: string;
  isBackground?: boolean;
}
interface LpLine {
  time: number;
  duration: number;
  text: string;
  syllabus?: LpSyllable[];
  element?: { singer?: string };
}
export interface LpResponse {
  type?: string;
  lyrics?: LpLine[];
}

const buildText = (syllables: LpSyllable[]): string => syllables.map((s) => s.text).join("").trim();

function toWordTimestamps(syllables: LpSyllable[]): WordTimestamp[] | null {
  const words = syllables
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({ text: s.text.trim(), startTime: s.time, endTime: s.time + Math.max(1, s.duration) }));
  return words.length > 0 ? words : null;
}

/** Background syllables become their own line after the main one, as on Android. */
export function convertLyricsPlus(response: LpResponse): LyricsEntry[] {
  const lines = response.lyrics ?? [];
  const isWordSync = response.type?.toLowerCase() === "word";
  const result: LyricsEntry[] = [];

  for (const line of lines) {
    const all = line.syllabus ?? [];
    const main = all.filter((s) => !s.isBackground);
    const background = all.filter((s) => s.isBackground);
    const mainText =
      isWordSync && main.length > 0
        ? buildText(main)
        : main.length === 0 && background.length > 0
          ? ""
          : line.text.trim();

    if (mainText) {
      result.push({
        time: line.time,
        text: mainText,
        words: isWordSync ? toWordTimestamps(main) : null,
        agent: line.element?.singer ?? null,
        isBackground: false,
      });
    }
    const backgroundText = buildText(background);
    if (backgroundText) {
      result.push({
        time: Math.min(...background.map((s) => s.time)),
        text: backgroundText,
        words: isWordSync ? toWordTimestamps(background) : null,
        agent: "bg",
        isBackground: true,
      });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

export const lyricsPlusProvider: LyricsProvider = {
  name: "LyricsPlus",
  async getLyrics(_id, title, artist, durationSec, album): Promise<LyricsEntry[]> {
    if (!title.trim() || !artist.trim()) return [];
    let url = `${SERVER}/v2/lyrics/get?title=${enc(title)}&artist=${enc(artist)}`;
    if (durationSec > 0) url += `&duration=${durationSec}`;
    if (album) url += `&album=${enc(album)}`;
    const response = await lyricsGetJson<LpResponse>(url, {
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/plain,*/*",
    });
    return convertLyricsPlus(response);
  },
};
