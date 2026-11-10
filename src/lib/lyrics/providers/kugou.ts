import type { LyricsEntry, LyricsProvider } from "../types";
import { lyricsGetJson, enc } from "../http";
import { isInstrumentalNotice, parseLyrics } from "../lyricsUtils";
import { cleanArtist, ranked, type MatchSong } from "../matching";

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

// A lyric search by keyword states the length in seconds, one by hash in milliseconds.
const LONGEST_DURATION_IN_SECONDS = 10_000;

const closeInLength = (seconds: number, request: MatchSong): boolean =>
  request.durationSec <= 0 || seconds <= 0 || Math.abs(seconds - request.durationSec) <= DURATION_TOLERANCE_SEC;

/** The song rows naming the requested song, best first. A close length alone proves nothing. */
export function matchingRows(rows: KuGouSong[], request: MatchSong): KuGouSong[] {
  return ranked(
    rows.filter((row) => closeInLength(row.duration ?? 0, request)),
    request,
    (row) => ({ title: stripTags(row.songname), artist: stripTags(row.singername), durationSec: row.duration ?? 0 }),
  );
}

const candidateSeconds = (candidate: LyricCandidate): number => {
  const duration = candidate.duration ?? 0;
  return Math.round(duration > LONGEST_DURATION_IN_SECONDS ? duration / 1000 : duration);
};

/** A hash can list another song's lyric first, so each candidate is checked on its own names. */
export function bestLyric(candidates: LyricCandidate[], request: MatchSong): LyricCandidate | null {
  return (
    ranked(
      candidates.filter((c) => c.id && c.accesskey && closeInLength(candidateSeconds(c), request)),
      request,
      (c) => ({ title: stripTags(c.song), artist: stripTags(c.singer), durationSec: candidateSeconds(c) }),
    )[0] ?? null
  );
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

async function lyricSearch(url: string): Promise<LyricCandidate[]> {
  return (await lyricsGetJson<LyricSearch>(url)).candidates ?? [];
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
    const keyword = `${normalizeTitle(title)} - ${normalizeArtist(cleanArtist(artist))}${album ? ` ${album}` : ""}`.trim();

    // A hash from the song search names the exact recording, so it is tried first.
    const songs = await lyricsGetJson<SongSearch>(
      `${SONG_SEARCH}?version=9108&plat=0&pagesize=${PAGE_SIZE}&showtype=0&keyword=${enc(keyword)}`,
    ).catch(() => null);
    for (const song of matchingRows(songs?.data?.info ?? [], request)) {
      if (!song.hash) continue;
      const candidates = await lyricSearch(`${LYRIC_SEARCH}?ver=1&man=yes&client=pc&hash=${enc(song.hash)}`);
      const entries = await fromCandidate(bestLyric(candidates, request));
      // The notice is KuGou's answer for this song; a later match could be a vocal version of it.
      if (entries.length > 0) return isInstrumentalNotice(entries) ? [] : entries;
    }

    let url = `${LYRIC_SEARCH}?ver=1&man=yes&client=pc`;
    if (durationSec > 0) url += `&duration=${durationSec * 1000}`;
    url += `&keyword=${enc(keyword)}`;
    const entries = await fromCandidate(bestLyric(await lyricSearch(url), request));
    return isInstrumentalNotice(entries) ? [] : entries;
  },
};
