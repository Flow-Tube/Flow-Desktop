import type { LyricsEntry, LyricsProvider, WordTimestamp } from "../types";
import { lyricsGetJsonOrMiss } from "../http";
import { parseLyrics } from "../lyricsUtils";
import { detectMs } from "./common";

const BASE = "https://api-lyrics.simpmusic.org/v1/";

interface SimpData {
  richSyncLyrics?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  plainLyric?: string;
  durationSeconds?: number;
  duration?: number;
}
interface SimpResponse {
  type?: string;
  data?: SimpData[];
}
interface RichItem {
  ts: number;
  te: number;
  l?: { c: string; o: number }[];
  x?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function resolveWordStartMs(lineStart: number, lineEnd: number, oMs: number): number {
  if (oMs >= lineStart - 1000 && oMs <= lineEnd + 1000) return clamp(oMs, lineStart, lineEnd);
  return clamp(lineStart + oMs, lineStart, lineEnd);
}

function parseRichSync(json: string, durationSec: number): LyricsEntry[] {
  const items = JSON.parse(json) as RichItem[];
  return items.map((item) => {
    const lineStart = detectMs(item.ts, durationSec);
    const lineEnd = detectMs(item.te, durationSec);
    const raw = (item.l ?? []).filter((w) => w.c.trim().length > 0);
    const words: WordTimestamp[] = raw.map((w, i) => {
      const start = resolveWordStartMs(lineStart, lineEnd, detectMs(w.o, durationSec));
      const end = i < raw.length - 1
        ? resolveWordStartMs(lineStart, lineEnd, detectMs(raw[i + 1]!.o, durationSec))
        : lineEnd;
      return { text: w.c.trim(), startTime: start, endTime: Math.max(start + 1, end) };
    });
    const text = item.x ?? words.map((w) => w.text).join(" ");
    return { time: lineStart, text, words: words.length ? words : null };
  });
}

export const simpMusicProvider: LyricsProvider = {
  name: "SimpMusic",
  async getLyrics(id, _title, _artist, durationSec): Promise<LyricsEntry[]> {
    if (!id) return [];
    const res = await lyricsGetJsonOrMiss<SimpResponse>(`${BASE}${id}`, {
      "User-Agent": "SimpMusicLyrics/1.0",
      Accept: "application/json",
    });
    if (res?.type !== "success" || !res.data?.length) return [];

    let best = res.data[0]!;
    if (durationSec > 0) {
      let bestDiff = Number.MAX_SAFE_INTEGER;
      for (const d of res.data) {
        const dur = d.durationSeconds ?? d.duration ?? 0;
        const diff = Math.abs(dur - durationSec);
        if (diff <= 10 && diff < bestDiff) {
          bestDiff = diff;
          best = d;
        }
      }
    }

    if (best.richSyncLyrics) {
      try {
        const entries = parseRichSync(best.richSyncLyrics, durationSec);
        if (entries.length > 0) return entries;
      } catch {
      }
    }
    if (best.syncedLyrics) return parseLyrics(best.syncedLyrics);
    const plain = best.plainLyrics ?? best.plainLyric;
    return plain ? [{ time: 0, text: plain }] : [];
  },
};
