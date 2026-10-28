import { getString } from "./i18n/index";
import type { SearchSuggestion, SuggestionEntity } from "../types/video";
import type { YTItem } from "../types/music";
import type { SearchHistoryEntry } from "../store/useSearchHistoryStore";

export const HISTORY_WHEN_EMPTY = 8;
export const HISTORY_WHEN_TYPING = 3;
export const MAX_QUERY_ROWS = 7;
export const MAX_MUSIC_ROWS = 5;

/** The music kinds a suggestion can open directly. */
export type SuggestedMusicItem = Extract<YTItem, { type: "song" | "album" | "artist" | "playlist" }>;

export type SuggestionRow =
  | { kind: "history"; key: string; query: string }
  | { kind: "query"; key: string; text: string; entity: SuggestionEntity | null }
  | { kind: "music"; key: string; item: SuggestedMusicItem };

export interface SuggestionColumns {
  /** History and text suggestions. */
  main: SuggestionRow[];
  /** YouTube Music songs, videos, artists and albums, opened directly. */
  side: SuggestionRow[];
}

const lower = (value: string) => value.trim().toLowerCase();

/** Past searches containing `query`, those starting with it first. */
export function matchHistory(entries: SearchHistoryEntry[], query: string, limit: number): string[] {
  const q = lower(query);
  if (!q) return entries.slice(0, limit).map((entry) => entry.query);
  const matches = entries.map((entry) => entry.query).filter((past) => lower(past).includes(q) && lower(past) !== q);
  const prefixed = matches.filter((past) => lower(past).startsWith(q));
  return [...prefixed, ...matches.filter((past) => !lower(past).startsWith(q))].slice(0, limit);
}

function isSuggestedMusicItem(item: YTItem): item is SuggestedMusicItem {
  return item.type === "song" || item.type === "album" || item.type === "artist" || item.type === "playlist";
}

export function musicItemKey(item: SuggestedMusicItem): string {
  switch (item.type) {
    case "song":
      return `song:${item.videoId ?? item.id}`;
    case "album":
      return `album:${item.browseId}`;
    case "artist":
      return `artist:${item.id}`;
    case "playlist":
      return `playlist:${item.id}`;
  }
}

export function buildSuggestionColumns({
  query,
  history,
  suggestions,
  musicItems,
  isHiddenSong,
}: {
  query: string;
  history: SearchHistoryEntry[];
  suggestions: SearchSuggestion[];
  musicItems: YTItem[];
  isHiddenSong?: (item: Extract<YTItem, { type: "song" }>) => boolean;
}): SuggestionColumns {
  const q = query.trim();
  if (!q) {
    return {
      main: matchHistory(history, "", HISTORY_WHEN_EMPTY).map((past) => ({ kind: "history", key: `history:${past}`, query: past })),
      side: [],
    };
  }

  const pastQueries = matchHistory(history, q, HISTORY_WHEN_TYPING);
  const shown = new Set(pastQueries.map(lower));
  const main: SuggestionRow[] = pastQueries.map((past) => ({ kind: "history", key: `history:${past}`, query: past }));
  for (const suggestion of suggestions) {
    if (main.length >= pastQueries.length + MAX_QUERY_ROWS) break;
    if (shown.has(lower(suggestion.text))) continue;
    shown.add(lower(suggestion.text));
    main.push({ kind: "query", key: `query:${suggestion.text}`, text: suggestion.text, entity: suggestion.entity });
  }

  const seen = new Set<string>();
  const side: SuggestionRow[] = [];
  for (const item of musicItems) {
    if (side.length >= MAX_MUSIC_ROWS) break;
    if (!isSuggestedMusicItem(item)) continue;
    if (item.type === "song" && isHiddenSong?.(item)) continue;
    const key = musicItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    side.push({ kind: "music", key, item });
  }
  return { main, side };
}

/** Splits a suggestion into what was typed and the completion, which is drawn bold. */
export function splitCompletion(text: string, query: string): { typed: string; completion: string } {
  const q = query.trimStart();
  if (q && text.toLowerCase().startsWith(q.toLowerCase())) {
    return { typed: text.slice(0, q.length), completion: text.slice(q.length) };
  }
  return { typed: "", completion: text };
}

const isVideoType = (type: string | null) => !!type && type !== "MUSIC_VIDEO_TYPE_ATV";

/** "Song · The Weeknd", "Album · The Weeknd · 2020", "Artist". */
export function musicItemSubtitle(item: SuggestedMusicItem): string {
  const parts: string[] = [];
  switch (item.type) {
    case "song": {
      const kind = getString(isVideoType(item.musicVideoType) ? "search_kind_video" : "search_kind_song");
      parts.push(kind);
      // A video with no uploader in its byline ("Video • 6.1M views") reads its type label as the artist.
      parts.push(item.artists.map((artist) => artist.name).filter((name) => lower(name) !== lower(kind)).join(", "));
      break;
    }
    case "album":
      parts.push(getString("search_kind_album"));
      parts.push((item.artists ?? []).map((artist) => artist.name).join(", "));
      if (item.year) parts.push(String(item.year));
      break;
    case "artist":
      parts.push(getString(item.isProfile ? "search_kind_profile" : "search_kind_artist"));
      break;
    case "playlist":
      parts.push(getString("search_kind_playlist"));
      if (item.author?.name) parts.push(item.author.name);
      break;
  }
  return parts.filter(Boolean).join(" · ");
}

/** How a music suggestion's picture is cropped. */
export function musicItemShape(item: SuggestedMusicItem): "circle" | "square" | "wide" {
  if (item.type === "artist") return "circle";
  if (item.type === "song" && isVideoType(item.musicVideoType)) return "wide";
  return "square";
}

export function musicItemImage(item: SuggestedMusicItem): string | null {
  return item.thumbnail || null;
}
