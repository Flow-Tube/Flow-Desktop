import type { LyricsEntry, LyricsProvider } from "../types";
import { enc, lyricsGetJson } from "../http";
import { parseLyrics } from "../lyricsUtils";
import { ranked } from "../matching";

const SEARCH_URL = "https://music.163.com/api/cloudsearch/pc";
const LYRIC_URL = "https://music.163.com/api/song/lyric";
const HEADERS = { Referer: "https://music.163.com/" };
const SEARCH_RESULTS = 10;
const MAX_LOOKUPS = 2;
const MIN_REAL_LINES = 6;

export interface NetEaseSong {
  id: number;
  name?: string;
  ar?: Array<{ name?: string }>;
  dt?: number;
}

/** NetEase writes some stamps as `[00:00.00-1]`, which no LRC reader expects. */
const STAMP_SUFFIX = /(\[\d+:\d+[.:]\d+)-\d+\]/g;
const CREDIT_LINE =
  /^(?:\[[^\]]*\])+\s*(?:作词|作曲|编曲|制作|制作人|监制|混音|母带|录音|和声|吉他|贝斯|鼓|弦乐|人声|出品|发行|词|曲|lyrics? by|written by|composed by|lyricist|composer|producer|arranger)\s*[:：].*$/i;

/** The timed lines of `lrc` without its credits, or nothing when too few real lines remain. */
export function parseNetEaseLyric(lrc: string): LyricsEntry[] {
  const lines = lrc
    .replace(STAMP_SUFFIX, "$1]")
    .split(/\r?\n/)
    .filter((line) => !CREDIT_LINE.test(line.trim()))
    .join("\n");
  const entries = parseLyrics(lines);
  return entries.filter((entry) => entry.text.trim()).length >= MIN_REAL_LINES ? entries : [];
}

/**
 * NetEase Cloud Music's public song search and lyric lookup, which need no account. Its catalogue
 * reaches well beyond Chinese music, in line-synced LRC. A song can hold only its credits as timed
 * lines, and that is no lyric at all, so an answer has to carry real lines to count.
 */
export const neteaseProvider: LyricsProvider = {
  name: "NetEase",
  async getLyrics(_id, title, artist, durationSec): Promise<LyricsEntry[]> {
    const query = `${title} ${artist}`.trim();
    const found = await lyricsGetJson<{ result?: { songs?: NetEaseSong[] } }>(
      `${SEARCH_URL}?s=${enc(query)}&type=1&limit=${SEARCH_RESULTS}`,
      HEADERS,
    );
    const candidates = ranked(found.result?.songs ?? [], { title, artist, durationSec }, (song) => ({
      title: song.name ?? "",
      artist: (song.ar ?? []).map((credit) => credit.name ?? "").join(", "),
      durationSec: Math.floor((song.dt ?? 0) / 1000),
    }));
    for (const song of candidates.slice(0, MAX_LOOKUPS)) {
      const lyric = await lyricsGetJson<{ lrc?: { lyric?: string | null } }>(`${LYRIC_URL}?id=${song.id}&lv=-1`, HEADERS);
      const entries = parseNetEaseLyric(lyric.lrc?.lyric ?? "");
      if (entries.length > 0) return entries;
    }
    return [];
  },
};
