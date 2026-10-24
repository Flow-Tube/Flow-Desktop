import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsGetJson, enc } from "../http";
import { parseLyrics } from "../lyricsUtils";
import { ranked, type MatchSong } from "../matching";

const SONG_SEARCH = "https://mobileservice.kugou.com/api/v3/search/song";
const LYRIC_SEARCH = "https://lyrics.kugou.com/search";
const LYRIC_DOWNLOAD = "https://lyrics.kugou.com/download";
const PAGE_SIZE = 8;
const HEAD_CUT_LIMIT = 30;
const DURATION_TOLERANCE_SEC = 8;

export interface KuGouSong {
  duration?: number;
  hash?: string;
  songname?: string;
  singername?: string;
}
interface SongSearch {
  data?: { info?: KuGouSong[] };
}
export interface LyricCandidate {
  id?: number;
  accesskey?: string;
  duration?: number;
  song?: string;
  singer?: string;
}
interface LyricSearch {
  candidates?: LyricCandidate[];
}

// Search answers can carry highlight markup around the matched words.
const stripTags = (text: string | undefined): string => (text ?? "").replace(/<[^>]+>/g, "");

const ACCEPTED = /^\[(\d\d):(\d\d)\.(\d{2,3})\].*/;
const BANNED = /^.+].+[:：].+$/;

/** KuGou ships base64'd LRC with credit lines padded at the head and foot. */
export function normalizeKuGouLrc(lrc: string): string {
  const lines = lrc.split(/\r?\n/).filter((line) => ACCEPTED.test(line));
  let headCut = 0;
  for (let i = Math.min(HEAD_CUT_LIMIT, lines.length - 1); i >= 0; i--) {
    if (BANNED.test(lines[i]!)) {
      headCut = i + 1;
      break;
    }
  }
  const kept = lines.slice(headCut);
  let tailCut = 0;
  for (let i = Math.min(lines.length - HEAD_CUT_LIMIT, lines.length - 1); i >= 0; i--) {
    if (BANNED.test(lines[lines.length - 1 - i]!)) {
      tailCut = i + 1;
      break;
    }
  }
  return kept.slice(0, Math.max(0, kept.length - tailCut)).join("\n");
}

const normalizeTitle = (title: string): string =>
  title
    .replace(/\(.*\)/g, "")
    .replace(/（.*）/g, "")
    .replace(/「.*」/g, "")
    .replace(/『.*』/g, "")
    .replace(/<.*>/g, "")
    .replace(/《.*》/g, "")
    .replace(/〈.*〉/g, "")
    .replace(/＜.*＞/g, "");

const normalizeArtist = (artist: string): string =>
  artist
    .split(", ").join("、")
    .split(" & ").join("、")
    .split(".").join("")
    .split("和").join("、")
    .replace(/\(.*\)/g, "")
    .replace(/（.*）/g, "");

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Hits that name the same recording, best first. KuGou has answered without names before; then
 * only the duration can be checked, as Android does.
 */
export function matchKuGou<T>(
  hits: T[],
  request: MatchSong,
  describe: (hit: T) => MatchSong,
): T[] {
  const named = hits.filter((hit) => describe(hit).title.trim());
  if (named.length > 0) return ranked(named, request, describe);
  return hits.filter((hit) => {
    const duration = describe(hit).durationSec;
    return request.durationSec <= 0 || Math.abs(duration - request.durationSec) <= DURATION_TOLERANCE_SEC;
  });
}

async function download(id: number, accesskey: string): Promise<string | null> {
  const url = `${LYRIC_DOWNLOAD}?fmt=lrc&charset=utf8&client=pc&ver=1&id=${id}&accesskey=${enc(accesskey)}`;
  const res = await lyricsGetJson<{ content?: string }>(url);
  if (!res.content) return null;
  try {
    return normalizeKuGouLrc(decodeBase64Utf8(res.content));
  } catch {
    return null;
  }
}

async function firstCandidate(url: string): Promise<LyricCandidate | null> {
  const res = await lyricsGetJson<LyricSearch>(url);
  return res.candidates?.find((c) => c.id && c.accesskey) ?? null;
}

async function fromCandidate(candidate: LyricCandidate | null): Promise<LyricsEntry[]> {
  if (!candidate?.id || !candidate.accesskey) return [];
  const lrc = await download(candidate.id, candidate.accesskey);
  return lrc ? parseLyrics(lrc) : [];
}

export const kugouProvider: LyricsProvider = {
  name: "KuGou",
  async getLyrics(_id, title, artist, durationSec, album): Promise<LyricsEntry[]> {
    const request: MatchSong = { title, artist, durationSec };
    const keyword = `${normalizeTitle(title)} - ${normalizeArtist(artist)}${album ? ` ${album}` : ""}`.trim();

    // A hash from the song search names the exact recording, so it is tried first.
    const songs = await lyricsGetJson<SongSearch>(
      `${SONG_SEARCH}?version=9108&plat=0&pagesize=${PAGE_SIZE}&showtype=0&keyword=${enc(keyword)}`,
    ).catch(() => null);
    const matches = matchKuGou(songs?.data?.info ?? [], request, (song) => ({
      title: stripTags(song.songname),
      artist: stripTags(song.singername),
      durationSec: song.duration ?? 0,
    }));
    for (const song of matches) {
      if (!song.hash) continue;
      const entries = await fromCandidate(
        await firstCandidate(`${LYRIC_SEARCH}?ver=1&man=yes&client=pc&hash=${enc(song.hash)}`),
      );
      if (entries.length > 0) return entries;
    }

    let url = `${LYRIC_SEARCH}?ver=1&man=yes&client=pc`;
    if (durationSec > 0) url += `&duration=${durationSec * 1000}`;
    url += `&keyword=${enc(keyword)}`;
    const search = await lyricsGetJson<LyricSearch>(url);
    const candidates = matchKuGou(
      (search.candidates ?? []).filter((c) => c.id && c.accesskey),
      request,
      (c) => ({ title: stripTags(c.song), artist: stripTags(c.singer), durationSec: Math.round((c.duration ?? 0) / 1000) }),
    );
    return fromCandidate(candidates[0] ?? null);
  },
};
