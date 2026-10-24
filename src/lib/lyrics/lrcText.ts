import type { LyricsEntry } from "./types";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Lyrics as `.lrc` text: `[mm:ss.xx]` lines when they are synced, else the plain text as it is. */
export function lrcText(syncedLyrics: LyricsEntry[], plainLyrics: string | null): string {
  if (syncedLyrics.length === 0) return plainLyrics ?? "";
  return syncedLyrics
    .map((entry) => {
      const minutes = Math.floor(entry.time / 60_000);
      const seconds = Math.floor((entry.time % 60_000) / 1000);
      const hundredths = Math.floor((entry.time % 1000) / 10);
      return `[${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}]${entry.text}`;
    })
    .join("\n");
}
