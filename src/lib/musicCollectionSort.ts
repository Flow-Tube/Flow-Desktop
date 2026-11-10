import { getString, type StringKey } from "./i18n/index";
import { artistsText } from "./musicFormat";
import { profileStorage } from "./storage/profileStorage";
import type { SongItem } from "../types/music";

const SORT_ORDERS_STORAGE_KEY = "flow_music_collection_sort_orders";

export const MUSIC_SORT_ORDERS = ["collection", "newest_added", "title", "artist", "album", "longest", "shortest"] as const;

export type MusicSortOrder = (typeof MUSIC_SORT_ORDERS)[number];

export interface MusicSortContext {
  /** An album from YouTube Music, not one of your own. */
  isOnlineAlbum: boolean;
  isOwned: boolean;
  isAlbumKind: boolean;
  hasAlbums: boolean;
}

/**
 * The orders a page has data for. An album keeps its track order and a single artist. Own lists
 * add songs at the end, so their reversed order is when each was added; YouTube's lists carry no date.
 */
export function availableMusicSortOrders(context: MusicSortContext): MusicSortOrder[] {
  return MUSIC_SORT_ORDERS.filter((order) => {
    switch (order) {
      case "newest_added":
        return context.isOwned;
      case "artist":
        return !context.isOnlineAlbum;
      case "album":
        return context.hasAlbums && !context.isOnlineAlbum;
      default:
        return true;
    }
  });
}

export function resolveMusicSortOrder(stored: string | null, available: MusicSortOrder[]): MusicSortOrder {
  return available.find((order) => order === stored) ?? "collection";
}

export function musicSortLabel(order: MusicSortOrder, isAlbumKind: boolean): string {
  if (order === "collection") return getString(isAlbumKind ? "music_sort_album_order" : "music_sort_collection");
  return getString(`music_sort_${order}` as StringKey);
}

const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

const compareBy = (songs: SongItem[], key: (song: SongItem) => string, compare = compareText) =>
  [...songs].sort((a, b) => compare(key(a), key(b)));

/** `songs` in `order`. Ties keep the page's own order, so a sort never shuffles equal songs. */
export function sortSongsForCollection(songs: SongItem[], order: MusicSortOrder): SongItem[] {
  switch (order) {
    case "collection":
      return songs;
    case "newest_added":
      return [...songs].reverse();
    case "title":
      return compareBy(songs, (song) => song.title);
    case "artist":
      return compareBy(songs, (song) => artistsText(song.artists));
    case "album":
      // Songs with no album go last, whatever the alphabet.
      return [...songs].sort((a, b) => {
        const left = a.album?.name ?? "";
        const right = b.album?.name ?? "";
        if (!left || !right) return Number(!left) - Number(!right);
        return compareText(left, right);
      });
    case "longest":
      return [...songs].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    case "shortest":
      return [...songs].sort((a, b) => (a.duration || Number.MAX_SAFE_INTEGER) - (b.duration || Number.MAX_SAFE_INTEGER));
  }
}

/** The songs whose title, artist or album hold every word of `query`. */
export function filterSongsBySearch(songs: SongItem[], query: string): SongItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return songs;
  return songs.filter((song) => {
    const text = `${song.title} ${artistsText(song.artists)} ${song.album?.name ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

const loadSortOrders = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(profileStorage.getItem(SORT_ORDERS_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

/** The order a page was last sorted by, or null when it never was. */
export const loadMusicSortOrder = (collectionId: string): string | null => loadSortOrders()[collectionId] ?? null;

export function saveMusicSortOrder(collectionId: string, order: MusicSortOrder): void {
  try {
    profileStorage.setItem(SORT_ORDERS_STORAGE_KEY, JSON.stringify({ ...loadSortOrders(), [collectionId]: order }));
  } catch (error) {
    console.warn("Failed to remember the music sort order", error);
  }
}
