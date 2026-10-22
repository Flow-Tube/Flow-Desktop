import { useCallback, useEffect, useRef, useState } from "react";
import { getPlaylistDetails } from "./api/youtube";
import {
  formatVideoCountText,
  getStoredPlaylistById,
  isProtectedPlaylistId,
  normalizePlaylist,
  resolvePlaylistTitle,
  type StoredPlaylist,
} from "./playlistLibrary";
import { appendUniqueVideos, loadRemainingPlaylistVideos } from "./playlistPages";
import type { VideoSummary } from "../types/video";

export interface PlaylistDetailsMeta {
  id: string;
  title: string;
  description?: string | null;
  channelName: string;
  viewCountText: string | null;
  videoCount: number;
  videoCountText: string;
  thumbnailUrl: string | null;
  updatedLabel: string;
}

export function usePlaylistDetails(playlistId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storedPlaylist, setStoredPlaylist] = useState<StoredPlaylist | null>(null);
  const [meta, setMeta] = useState<PlaylistDetailsMeta | null>(null);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  // The next page of a playlist read from YouTube; a saved playlist shows its own tracks.
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const pagingRef = useRef(false);

  const load = useCallback(async () => {
    if (!playlistId) {
      setLoading(false);
      setError("Playlist not found");
      return;
    }

    setLoading(true);
    setError(null);
    setNextPageToken(null);
    setLoadMoreFailed(false);

    try {
      const stored = await getStoredPlaylistById(playlistId);
      const normalizedStored = stored ? normalizePlaylist(stored) : null;
      setStoredPlaylist(normalizedStored);

      let remoteVideos: VideoSummary[] = [];
      let remoteTitle: string | null = null;
      let remoteChannel = isProtectedPlaylistId(playlistId) ? "Flow" : "YouTube";
      let remoteDescription: string | null = null;
      let remoteCount: number | null = null;
      let remoteViewCountText: string | null = null;
      let remoteNextPageToken: string | null = null;

      if (!isProtectedPlaylistId(playlistId)) {
        try {
          const details = await getPlaylistDetails(playlistId);
          remoteVideos = details.videos ?? [];
          remoteTitle = details.title;
          remoteChannel = details.channelName || remoteChannel;
          remoteDescription = details.description ?? null;
          remoteCount = details.videoCount ?? remoteVideos.length;
          remoteViewCountText = details.viewCountText ?? null;
          remoteNextPageToken = details.nextPageToken ?? null;
        } catch (fetchError) {
          console.warn("Failed to fetch remote playlist details", fetchError);
          if (!normalizedStored) {
            throw fetchError;
          }
        }
      }

      const resolvedVideos = normalizedStored?.tracks.length
        ? normalizedStored.tracks
        : remoteVideos;

      const usesRemote = !normalizedStored?.tracks.length;
      const videoCount = usesRemote && remoteCount
        ? Math.max(remoteCount, resolvedVideos.length)
        : resolvedVideos.length || remoteCount || normalizedStored?.videoCount || 0;

      const thumbnailUrl = normalizedStored?.thumbnailUrl
        ?? resolvedVideos[0]?.thumbnailUrl
        ?? remoteVideos[0]?.thumbnailUrl
        ?? null;

      const title = resolvePlaylistTitle(
        normalizedStored?.name,
        normalizedStored?.sourceTitle,
        remoteTitle,
      );

      const updatedAt = normalizedStored?.createdAt;
      const updatedLabel = normalizedStored?.isProtected
        ? "Built-in playlist"
        : updatedAt
        ? formatUpdatedLabel(updatedAt)
        : "Updated recently";

      setVideos(resolvedVideos);
      setNextPageToken(usesRemote ? remoteNextPageToken : null);
      const resolvedOwner = !isUnknownOwner(remoteChannel)
        ? remoteChannel
        : resolvedVideos[0]?.channelName ?? remoteChannel;

      setMeta({
        id: playlistId,
        title,
        description: normalizedStored?.description ?? remoteDescription,
        channelName: resolvedOwner,
        viewCountText: remoteViewCountText,
        videoCount: videoCount > 0 ? videoCount : resolvedVideos.length,
        videoCountText: formatVideoCountText(
          videoCount > 0 ? videoCount : resolvedVideos.length,
        ),
        thumbnailUrl,
        updatedLabel,
      });
    } catch (loadError) {
      console.error("Failed to load playlist details", loadError);
      setError("Could not load this playlist.");
      setMeta(null);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!playlistId || !nextPageToken || pagingRef.current) return;
    pagingRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await getPlaylistDetails(playlistId, nextPageToken);
      setVideos((current) => appendUniqueVideos(current, page.videos ?? []));
      setNextPageToken(page.nextPageToken ?? null);
    } catch (pageError) {
      console.warn("Failed to load the next playlist page", pageError);
      setLoadMoreFailed(true);
    } finally {
      pagingRef.current = false;
      setLoadingMore(false);
    }
  }, [playlistId, nextPageToken]);

  /** Every video of the playlist, reading the pages not loaded yet. */
  const loadAllVideos = useCallback(async (): Promise<VideoSummary[]> => {
    if (!playlistId || !nextPageToken || pagingRef.current) return videos;
    pagingRef.current = true;
    setLoadingMore(true);
    try {
      const all = await loadRemainingPlaylistVideos(playlistId, videos, nextPageToken);
      setVideos(all);
      setNextPageToken(null);
      return all;
    } finally {
      pagingRef.current = false;
      setLoadingMore(false);
    }
  }, [playlistId, nextPageToken, videos]);

  return {
    loading,
    error,
    storedPlaylist,
    meta,
    videos,
    setVideos,
    reload: load,
    hasMore: nextPageToken !== null,
    loadingMore,
    loadMoreFailed,
    loadMore,
    loadAllVideos,
  };
}

function isUnknownOwner(name: string) {
  return name.trim().toLowerCase() === "unknown owner";
}

function formatUpdatedLabel(isoDate: string) {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return "Updated recently";

  const diffMs = Date.now() - timestamp;
  const dayMs = 86_400_000;

  if (diffMs < dayMs) return "Updated today";
  if (diffMs < dayMs * 2) return "Updated yesterday";
  if (diffMs < dayMs * 7) return "Updated this week";

  return `Updated ${new Date(timestamp).toLocaleDateString()}`;
}
