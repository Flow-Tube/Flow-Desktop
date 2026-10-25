import { useEffect } from "react";

import { useAlbumLibraryStore } from "../store/useAlbumLibraryStore";
import { useCollectionDownloadStore } from "../store/useCollectionDownloadStore";
import { useDownloadCollectionsLibraryStore } from "../store/useDownloadCollectionsLibraryStore";
import { getMusicAlbumContinuation, getMusicAlbumPage } from "./api/music";
import { getPlaylistDetails } from "./api/youtube";
import { getStoredPlaylistById, isProtectedPlaylistId, normalizePlaylist } from "./playlistLibrary";
import { loadRemainingPlaylistVideos } from "./playlistPages";
import type { DownloadCollectionKind, DownloadCollectionRecord } from "./api/downloads";
import type { AlbumItem, SongItem } from "../types/music";
import type { PlaylistSummary, VideoSummary } from "../types/video";

const ALBUM_PAGE_GUARD = 30;

export interface CollectionDownloadState {
  /** Total items in the playlist/album. */
  total: number;
  /** Items already saved. */
  completed: number;
  /** A download run is in flight. */
  active: boolean;
  isComplete: boolean;
  /** A run or saved record exists for this collection. */
  exists: boolean;
}

function useEnsureCollectionsLoaded() {
  const loaded = useDownloadCollectionsLibraryStore((state) => state.loaded);
  const load = useDownloadCollectionsLibraryStore((state) => state.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
}

/** The persisted collections plus mutators; loads itself on first use. */
export function useDownloadCollectionsLibrary() {
  useEnsureCollectionsLoaded();
  const records = useDownloadCollectionsLibraryStore((state) => state.records);
  const loading = useDownloadCollectionsLibraryStore((state) => state.loading);
  const remove = useDownloadCollectionsLibraryStore((state) => state.remove);
  const reload = useDownloadCollectionsLibraryStore((state) => state.load);
  return { records, loading, remove, reload };
}

/** Live + persisted download progress for one playlist/album. */
export function useCollectionDownloadState(
  collectionId: string | null | undefined,
  kind: DownloadCollectionKind,
): CollectionDownloadState {
  useEnsureCollectionsLoaded();
  const run = useCollectionDownloadStore((state) =>
    collectionId
      ? Object.values(state.runs).find((r) => r.collectionId === collectionId && r.kind === kind)
      : undefined,
  );
  const record = useDownloadCollectionsLibraryStore((state) =>
    collectionId
      ? state.records.find((r) => r.collectionId === collectionId && r.kind === kind)
      : undefined,
  );

  const total = run?.total ?? record?.totalCount ?? 0;
  const completed = Math.max(run?.completed ?? 0, record?.downloadedCount ?? 0);
  const active = run?.active ?? false;
  return {
    total,
    completed,
    active,
    isComplete: total > 0 && completed >= total && !active,
    exists: Boolean(run || record),
  };
}

/** Resolves a playlist's full video list — from its stored tracks or by paging the
 *  remote playlist — and hands it to the collection download run. Self-contained so
 *  any playlist card can download without the caller pre-loading its videos. */
export async function downloadPlaylist(playlist: PlaylistSummary): Promise<void> {
  const stored = await getStoredPlaylistById(playlist.id);
  const normalized = stored ? normalizePlaylist(stored) : null;

  const videos: VideoSummary[] = normalized?.tracks ? [...normalized.tracks] : [];
  let title = normalized?.name ?? playlist.title;
  let author: string | undefined;
  let thumbnailUrl = playlist.thumbnailUrl ?? normalized?.thumbnailUrl ?? undefined;

  if (videos.length === 0 && !isProtectedPlaylistId(playlist.id)) {
    const first = await getPlaylistDetails(playlist.id);
    title = first.title || title;
    author = first.channelName || author;
    thumbnailUrl = thumbnailUrl ?? first.videos?.[0]?.thumbnailUrl ?? undefined;
    videos.push(
      ...(await loadRemainingPlaylistVideos(playlist.id, first.videos ?? [], first.nextPageToken)),
    );
  }

  if (videos.length === 0) return;

  await useCollectionDownloadStore.getState().startPlaylist(
    { collectionId: playlist.id, title, author, thumbnailUrl },
    videos,
  );
}

/** Downloads an album's full track list. Owned albums live only in the local
 *  library and carry a generated id (not a remote browseId), so their stored tracks
 *  are used directly; remote albums are paged from the album endpoint. */
export async function downloadAlbum(album: AlbumItem): Promise<void> {
  const owned = useAlbumLibraryStore
    .getState()
    .albums.find((a) => a.source === "Owned" && a.id === album.browseId);

  let songs: SongItem[];
  if (owned) {
    songs = owned.tracks ?? [];
  } else {
    const page = await getMusicAlbumPage(album.browseId);
    songs = [...page.songs];
    let continuation = page.continuation;
    let guard = 0;
    while (continuation && guard < ALBUM_PAGE_GUARD) {
      const [moreSongs, nextContinuation] = await getMusicAlbumContinuation(continuation);
      songs.push(...moreSongs);
      continuation = nextContinuation;
      guard += 1;
    }
  }

  if (songs.length === 0) return;

  await useCollectionDownloadStore.getState().startAlbum(
    {
      collectionId: album.browseId,
      title: album.title,
      author: album.artists?.[0]?.name ?? undefined,
      thumbnailUrl: album.thumbnail || undefined,
      year: album.year,
    },
    songs,
  );
}

/** Progress for a persisted collection record, merged with any live run. */
export function collectionProgress(
  record: DownloadCollectionRecord,
  run: { total: number; completed: number; active: boolean } | undefined,
): CollectionDownloadState {
  const total = run?.total ?? record.totalCount;
  const completed = Math.max(run?.completed ?? 0, record.downloadedCount);
  const active = run?.active ?? false;
  return {
    total,
    completed,
    active,
    isComplete: total > 0 && completed >= total && !active,
    exists: true,
  };
}
