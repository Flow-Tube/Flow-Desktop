import type { DownloadTarget } from "./downloadMany";
import { songToFileEntry, videoToFileEntry, type PlaylistFileContents } from "./playlistFile";
import {
  loadPlaylistSortOrder,
  PLAYLIST_SORT_ORDERS,
  savePlaylistSortOrder,
  sortPlaylistVideos,
  type PlaylistSortOrder,
} from "./playlistSort";
import type { LikedItem, LikedItemKind } from "../store/useLikesStore";
import type { VideoSummary } from "../types/video";

// Likes have no order of their own besides when each was liked, as on Android.
const SORT_STORAGE_ID = "likes";
export const DEFAULT_LIKES_SORT: PlaylistSortOrder = "date_added_newest";
export const LIKES_SORT_ORDERS = PLAYLIST_SORT_ORDERS.filter((order) => order !== "manual");

export const loadLikesSortOrder = (): PlaylistSortOrder =>
  LIKES_SORT_ORDERS.find((order) => order === loadPlaylistSortOrder(SORT_STORAGE_ID)) ?? DEFAULT_LIKES_SORT;

export const saveLikesSortOrder = (order: PlaylistSortOrder) => savePlaylistSortOrder(SORT_STORAGE_ID, order);

export const likedItemKey = (item: Pick<LikedItem, "kind" | "id">) => `${item.kind}:${item.id}`;

function sortableView(item: LikedItem): VideoSummary {
  const likedAt = Date.parse(item.likedAt);
  const shared = { id: likedItemKey(item), addedAtInPlaylist: Number.isNaN(likedAt) ? null : likedAt };
  return item.kind === "music"
    ? { ...shared, title: item.song?.title ?? "", channelName: "", durationSeconds: item.song?.duration, viewCountText: item.song?.viewsText }
    : { ...item.video, ...shared };
}

export function sortLikedItems(items: LikedItem[], order: PlaylistSortOrder, now = Date.now()): LikedItem[] {
  const byKey = new Map(items.map((item) => [likedItemKey(item), item]));
  return sortPlaylistVideos(items.map(sortableView), order, true, now).flatMap((view) => byKey.get(view.id) ?? []);
}

/**
 * Songs and videos play in different players and teach different engines, so a list can't be
 * queued or saved as one. With both on show, Save takes the videos.
 */
export function likedActionKind(items: LikedItem[]): LikedItemKind | null {
  if (items.some((item) => item.kind === "video")) return "video";
  return items.length > 0 ? "music" : null;
}

export const likedVideos = (items: LikedItem[]): VideoSummary[] =>
  items.flatMap((item) => (item.kind === "video" && item.video ? [item.video] : []));

export const likedSongs = (items: LikedItem[]) =>
  items.flatMap((item) => (item.kind === "music" && item.song ? [item.song] : []));

export const likedDownloadTargets = (items: LikedItem[]): DownloadTarget[] =>
  items.flatMap<DownloadTarget>((item) => {
    if (item.kind === "video") return item.video ? [{ kind: "video", video: item.video }] : [];
    return item.song ? [{ kind: "music", song: item.song }] : [];
  });

/** The likes on show as a playlist file; `null` when there is nothing to save. */
export function likedPlaylistFile(items: LikedItem[], name: string): PlaylistFileContents | null {
  const kind = likedActionKind(items);
  if (!kind) return null;
  return {
    name,
    description: "",
    isMusic: kind === "music",
    videos: kind === "music"
      ? likedSongs(items).map(songToFileEntry)
      : items.flatMap((item) => (
        item.kind === "video" && item.video
          ? [{ ...videoToFileEntry(item.video), addedAt: Date.parse(item.likedAt) || null }]
          : []
      )),
  };
}
