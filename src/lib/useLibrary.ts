import { useCallback, useEffect, useState } from "react";
import { getWatchHistory } from "./api/db";
import { listDownloads } from "./api/downloads";
import { downloadShelves } from "./downloadShelves";
import { mapHistoryRecordToVideo, type HistoryVideo } from "./useHistory";
import type { SongItem } from "../types/music";
import {
  loadStoredPlaylists,
  PLAYLIST_LIBRARY_UPDATED_EVENT,
  storedPlaylistToCardSummary,
  WATCH_LATER_PLAYLIST_ID,
} from "./playlistLibrary";
import {
  loadSavedShorts,
  SAVED_SHORTS_LIBRARY_UPDATED_EVENT,
} from "./savedShortsLibrary";
import { likedItemToHistoryVideo } from "./useLikes";
import { useAlbumLibraryStore } from "../store/useAlbumLibraryStore";
import { LIKES_LIBRARY_UPDATED_EVENT, useLikesStore } from "../store/useLikesStore";
import type { ShortVideoSummary, VideoSummary } from "../types/video";

const SHELF_PREVIEW_LIMIT = 15;

export type LibraryPlaylist = ReturnType<typeof storedPlaylistToCardSummary>;

interface AsyncLibraryData {
  history: HistoryVideo[];
  playlists: LibraryPlaylist[];
  watchLater: VideoSummary[];
  liked: HistoryVideo[];
  savedShorts: ShortVideoSummary[];
  videoDownloads: VideoSummary[];
  musicDownloads: SongItem[];
}

const EMPTY_LIBRARY: AsyncLibraryData = {
  history: [],
  playlists: [],
  watchLater: [],
  liked: [],
  savedShorts: [],
  videoDownloads: [],
  musicDownloads: [],
};

export function useLibrary() {
  const [data, setData] = useState<AsyncLibraryData>(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(true);

  const savedAlbums = useAlbumLibraryStore((s) => s.albums);
  const albumsLoaded = useAlbumLibraryStore((s) => s.loaded);
  const loadAlbums = useAlbumLibraryStore((s) => s.load);

  useEffect(() => {
    if (!albumsLoaded) void loadAlbums();
  }, [albumsLoaded, loadAlbums]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [historyRecords, storedPlaylists, savedShorts, downloadRecords] = await Promise.all([
        getWatchHistory(SHELF_PREVIEW_LIMIT, 0).catch((error) => {
          console.warn("Library: failed to load history", error);
          return [];
        }),
        loadStoredPlaylists().catch((error) => {
          console.warn("Library: failed to load playlists", error);
          return [];
        }),
        loadSavedShorts().catch((error) => {
          console.warn("Library: failed to load saved Shorts", error);
          return [];
        }),
        listDownloads().catch((error) => {
          console.warn("Library: failed to load downloads", error);
          return [];
        }),
      ]);

      const downloads = downloadShelves(downloadRecords, SHELF_PREVIEW_LIMIT);
      const watchLaterPlaylist = storedPlaylists.find((playlist) => (
        playlist.id === WATCH_LATER_PLAYLIST_ID
      ));
      await useLikesStore.getState().load();
      const liked = useLikesStore.getState().items
        .map(likedItemToHistoryVideo)
        .slice(0, SHELF_PREVIEW_LIMIT);

      setData({
        history: historyRecords.map(mapHistoryRecordToVideo),
        playlists: storedPlaylists.map(storedPlaylistToCardSummary),
        watchLater: watchLaterPlaylist?.tracks.slice(0, SHELF_PREVIEW_LIMIT) ?? [],
        liked,
        savedShorts: savedShorts.slice(0, SHELF_PREVIEW_LIMIT),
        videoDownloads: downloads.videos,
        musicDownloads: downloads.songs,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, refresh);
    window.addEventListener(LIKES_LIBRARY_UPDATED_EVENT, refresh);
    window.addEventListener(SAVED_SHORTS_LIBRARY_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, refresh);
      window.removeEventListener(LIKES_LIBRARY_UPDATED_EVENT, refresh);
      window.removeEventListener(SAVED_SHORTS_LIBRARY_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  return { ...data, savedAlbums, loading, refresh };
}
