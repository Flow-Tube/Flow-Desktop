import { getString, type StringKey } from "./i18n/index";
import { parseToTimestamp } from "./publishedDate";
import type { VideoSummary } from "../types/video";

// Mirrors Flow-Android's PlaylistSorting.

const TIMESTAMP_TOLERANCE_MS = 30 * 60 * 1000;
const SORT_ORDERS_STORAGE_KEY = "flow_playlist_sort_orders";

export const PLAYLIST_SORT_ORDERS = [
  "manual",
  "date_added_newest",
  "date_added_oldest",
  "most_popular",
  "date_published_newest",
  "date_published_oldest",
] as const;

export type PlaylistSortOrder = (typeof PLAYLIST_SORT_ORDERS)[number];

export const playlistSortLabel = (order: PlaylistSortOrder): string =>
  getString(`playlist_sort_${order}` as StringKey);

/** Rows show when each video was added only while the list is ordered by it. */
export const showsDateAdded = (order: PlaylistSortOrder): boolean =>
  order === "date_added_newest" || order === "date_added_oldest";

/** The orders a playlist has data for: a YouTube playlist carries no date a video was added. */
export const availablePlaylistSortOrders = (isLocalPlaylist: boolean): PlaylistSortOrder[] =>
  isLocalPlaylist
    ? [...PLAYLIST_SORT_ORDERS]
    : PLAYLIST_SORT_ORDERS.filter((order) => order !== "date_added_newest" && order !== "date_added_oldest");

export const resolvePlaylistSortOrder = (
  stored: string | null,
  isLocalPlaylist: boolean,
): PlaylistSortOrder =>
  availablePlaylistSortOrders(isLocalPlaylist).find((order) => order === stored) ?? "manual";

const loadPlaylistSortOrders = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SORT_ORDERS_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

/** The order a playlist was last sorted by, or null when it never was. */
export const loadPlaylistSortOrder = (playlistId: string): string | null =>
  loadPlaylistSortOrders()[playlistId] ?? null;

export const savePlaylistSortOrder = (playlistId: string, order: PlaylistSortOrder) => {
  try {
    localStorage.setItem(
      SORT_ORDERS_STORAGE_KEY,
      JSON.stringify({ ...loadPlaylistSortOrders(), [playlistId]: order }),
    );
  } catch (error) {
    console.error("Failed to persist playlist sort", error);
  }
};

export const parseViewCount = (text?: string | null): number => {
  if (!text) return 0;
  const normalized = text.toLowerCase();
  const match = normalized.match(/([\d,.]+)\s*([kmb])?/);
  if (!match?.[1]) return 0;

  let value = Number.parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(value)) return 0;

  const suffix = match[2];
  if (suffix === "k") value *= 1_000;
  if (suffix === "m") value *= 1_000_000;
  if (suffix === "b") value *= 1_000_000_000;
  return value;
};

function effectivePlaylistUploadTimestamp(video: VideoSummary, now: number): number {
  const parsed = video.publishedText ? parseToTimestamp(video.publishedText, now) : null;
  const stored = video.publishedAt ?? 0;
  if (stored <= 0) return parsed ?? 0;
  if (parsed === null) return stored;
  return stored < parsed - TIMESTAMP_TOLERANCE_MS ? stored : parsed;
}

// Tracks saved before add times were kept have none; they predate every timed track, so they
// sink below them and keep the order their position gives.
function sortedByDateAdded(videos: VideoSummary[], descending: boolean, storedNewestFirst: boolean): VideoSummary[] {
  const byPosition = storedNewestFirst ? videos : [...videos].reverse();
  const keyed = byPosition.map((video) => [video, video.addedAtInPlaylist ?? 0] as const);
  keyed.sort((a, b) => b[1] - a[1]);
  const newestFirst = keyed.map(([video]) => video);
  return descending ? newestFirst : newestFirst.reverse();
}

function sortedByPublishDate(videos: VideoSummary[], descending: boolean, now: number): VideoSummary[] {
  const keyed = videos.map((video) => [video, effectivePlaylistUploadTimestamp(video, now)] as const);
  keyed.sort((a, b) => (descending ? b[1] - a[1] : a[1] - b[1]));
  return keyed.map(([video]) => video);
}

/**
 * `storedNewestFirst` says how the list is kept: Watch Later prepends new tracks, other
 * playlists append. It orders tracks that have no add time.
 */
export function sortPlaylistVideos(
  videos: VideoSummary[],
  order: PlaylistSortOrder,
  storedNewestFirst: boolean,
  now = Date.now(),
): VideoSummary[] {
  switch (order) {
    case "manual":
      return videos;
    case "date_added_newest":
      return sortedByDateAdded(videos, true, storedNewestFirst);
    case "date_added_oldest":
      return sortedByDateAdded(videos, false, storedNewestFirst);
    case "most_popular":
      return [...videos].sort(
        (a, b) => parseViewCount(b.viewCountText) - parseViewCount(a.viewCountText),
      );
    case "date_published_newest":
      return sortedByPublishDate(videos, true, now);
    case "date_published_oldest":
      return sortedByPublishDate(videos, false, now);
  }
}
