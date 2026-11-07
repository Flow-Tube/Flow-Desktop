import type { LyricsEntry, LyricsProvider } from "../types";
import { enc, lyricsGetJsonOrMiss } from "../http";
import { best, type MatchSong } from "../matching";
import { parseTTMLToLyricsEntries } from "../ttmlParser";

const BASE_URL = "https://api.amll.dev/v1/lyrics";
const HEADERS = { Accept: "application/json" };

export interface AmllItem {
  id: number;
  musicNames?: string[];
  artistNames?: string[];
}

/** The entry naming the requested song under any of its names. */
export function pickAmllItem(items: AmllItem[], request: MatchSong): AmllItem | null {
  const names = items.flatMap((item) => (item.musicNames ?? []).map((name) => ({ item, name })));
  const match = best(names, request, ({ item, name }) => ({
    title: name,
    artist: (item.artistNames ?? []).join(", "),
    durationSec: 0,
  }));
  return match?.item ?? null;
}

/**
 * The AMLL lyrics database: word-synced TTML that people contribute, behind an open API with no
 * key. Its catalogue is small, so it sits near the end of the order, and each entry lists every
 * name its song goes by, any of which can match the request.
 */
export const amllProvider: LyricsProvider = {
  name: "AMLL",
  async getLyrics(_id, title, artist, durationSec): Promise<LyricsEntry[]> {
    if (!title.trim() || !artist.trim()) return [];
    const found = await lyricsGetJsonOrMiss<{ data?: { items?: AmllItem[] } }>(
      `${BASE_URL}/search?musicName=${enc(title)}&artistName=${enc(artist)}`,
      HEADERS,
    );
    const item = pickAmllItem(found?.data?.items ?? [], { title, artist, durationSec });
    if (!item) return [];
    const lyric = await lyricsGetJsonOrMiss<{ data?: { lyrics?: string | null } }>(
      `${BASE_URL}/get?id=${item.id}&format=ttml`,
      HEADERS,
    );
    const document = lyric?.data?.lyrics;
    return document?.trim() ? parseTTMLToLyricsEntries(document) : [];
  },
};
