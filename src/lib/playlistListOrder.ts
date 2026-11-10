import { getString, type StringKey } from "./i18n/index";
import { getPlaylistTimestamp, type StoredPlaylist } from "./playlistLibrary";
import { profileStorage } from "./storage/profileStorage";

// Mirrors Flow-Android's PlaylistListOrder.

const ORDER_STORAGE_KEY = "flow_playlist_list_order";
const CUSTOM_ORDER_STORAGE_KEY = "flow_playlist_custom_order";

export const PLAYLIST_LIST_ORDERS = ["newest", "oldest", "name", "custom"] as const;

export type PlaylistListOrder = (typeof PLAYLIST_LIST_ORDERS)[number];

export const playlistListOrderLabel = (order: PlaylistListOrder): string =>
  getString(`playlists_sort_${order}` as StringKey);

export const loadPlaylistListOrder = (): PlaylistListOrder => {
  const stored = profileStorage.getItem(ORDER_STORAGE_KEY);
  return PLAYLIST_LIST_ORDERS.find((order) => order === stored) ?? "newest";
};

export const savePlaylistListOrder = (order: PlaylistListOrder) => {
  try {
    profileStorage.setItem(ORDER_STORAGE_KEY, order);
  } catch (error) {
    console.error("Failed to persist playlist order", error);
  }
};

// Kept apart from the library because a sync rewrites the stored list in its own order.
export const loadPlaylistCustomOrder = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(profileStorage.getItem(CUSTOM_ORDER_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

export const savePlaylistCustomOrder = (ids: string[]) => {
  try {
    profileStorage.setItem(CUSTOM_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch (error) {
    console.error("Failed to persist the custom playlist order", error);
  }
};

const newestFirst = (a: StoredPlaylist, b: StoredPlaylist) => getPlaylistTimestamp(b) - getPlaylistTimestamp(a);

/** A sorted copy. In the custom order, a playlist not placed yet comes first, newest first. */
export function sortStoredPlaylists(
  playlists: StoredPlaylist[],
  order: PlaylistListOrder,
  customOrder: string[],
): StoredPlaylist[] {
  const sorted = [...playlists];
  switch (order) {
    case "newest":
      return sorted.sort(newestFirst);
    case "oldest":
      return sorted.sort((a, b) => newestFirst(b, a));
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    case "custom": {
      const place = new Map(customOrder.map((id, index) => [id, index]));
      return sorted.sort((a, b) => (place.get(a.id) ?? -1) - (place.get(b.id) ?? -1) || newestFirst(a, b));
    }
  }
}
