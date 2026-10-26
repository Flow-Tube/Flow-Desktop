import { create } from "zustand";

import {
  createDownloadCollection,
  type DownloadCollectionKind,
  type DownloadProgress,
  type DownloadStarted,
} from "../lib/api/downloads";
import { startMusicDownload, startVideoDownload } from "../lib/downloadActions";
import { SETTINGS } from "../lib/settings/schema";
import { useAppSettingsStore } from "./useAppSettingsStore";
import { useDownloadCollectionsLibraryStore } from "./useDownloadCollectionsLibraryStore";
import { useDownloadsLibraryStore } from "./useDownloadsLibraryStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface CollectionMeta {
  collectionId: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  /** An album's release year, written into each song. */
  year?: number | null;
}

export interface CollectionRun {
  dbId: number;
  collectionId: string;
  kind: DownloadCollectionKind;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  total: number;
  completed: number;
  failed: number;
  active: boolean;
}

/** Choices made in the album and playlist sheet. */
export interface CollectionOptions {
  /** A base folder instead of the download folder from Settings. */
  destinationDirectory?: string;
  musicQuality?: "High" | "Low";
}

interface CollectionDownloadState {
  runs: Record<number, CollectionRun>;
  startPlaylist: (meta: CollectionMeta, videos: VideoSummary[], options?: CollectionOptions) => Promise<void>;
  startAlbum: (meta: CollectionMeta, songs: SongItem[], options?: CollectionOptions) => Promise<void>;
  handleProgress: (progress: DownloadProgress) => void;
  dismissRun: (dbId: number) => void;
}

const itemWaiters = new Map<string, () => void>();

export const useCollectionDownloadStore = create<CollectionDownloadState>((set) => {
  const bumpRun = (dbId: number, key: "completed" | "failed") =>
    set((state) => {
      const run = state.runs[dbId];
      if (!run) return {};
      return { runs: { ...state.runs, [dbId]: { ...run, [key]: run[key] + 1 } } };
    });

  async function runCollection<T>(
    kind: DownloadCollectionKind,
    meta: CollectionMeta,
    options: CollectionOptions,
    items: T[],
    idOf: (item: T) => string,
    start: (item: T, folderPath: string, dbId: number) => Promise<DownloadStarted | null>,
  ): Promise<void> {
    if (items.length === 0) return;

    let created;
    try {
      created = await createDownloadCollection({
        collectionId: meta.collectionId,
        kind,
        title: meta.title,
        author: meta.author,
        thumbnailUrl: meta.thumbnailUrl,
        totalCount: items.length,
        destinationDirectory:
          options.destinationDirectory
          || settings()[kind === "album" ? SETTINGS.MUSIC_DOWNLOAD_LOCATION : SETTINGS.DOWNLOAD_LOCATION]
          || undefined,
      });
    } catch (error) {
      console.error("Failed to create the download collection", error);
      return;
    }

    const { id: dbId, folderPath, existingVideoIds } = created;
    const alreadySaved = new Set(existingVideoIds);
    const pending = items.filter((item) => !alreadySaved.has(idOf(item)));

    set((state) => ({
      runs: {
        ...state.runs,
        [dbId]: {
          dbId,
          collectionId: meta.collectionId,
          kind,
          title: meta.title,
          author: meta.author,
          thumbnailUrl: meta.thumbnailUrl,
          total: items.length,
          completed: alreadySaved.size,
          failed: 0,
          active: true,
        },
      },
    }));
    // Surface the collection on the Downloads page immediately, before any item finishes.
    void useDownloadCollectionsLibraryStore.getState().load();

    const queue = [...pending];
    const worker = async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        try {
          const started = await start(item, folderPath, dbId);
          if (!started) {
            bumpRun(dbId, "failed");
            continue;
          }
          await new Promise<void>((resolve) => {
            itemWaiters.set(started.id, resolve);
          });
        } catch (error) {
          console.warn("A collection item failed to start downloading", error);
          bumpRun(dbId, "failed");
        }
      }
    };

    await Promise.all(
      // As many workers as downloads may run at once; the backend queue holds the rest.
      Array.from(
        { length: Math.min(Number(settings()[SETTINGS.DOWNLOAD_CONCURRENCY] ?? 3) || 3, queue.length) },
        () => worker(),
      ),
    );

    set((state) => {
      const run = state.runs[dbId];
      if (!run) return {};
      return { runs: { ...state.runs, [dbId]: { ...run, active: false } } };
    });
    void useDownloadCollectionsLibraryStore.getState().load();
    void useDownloadsLibraryStore.getState().load();
  }

  const settings = () => useAppSettingsStore.getState().values;
  const withQuality = (values: Record<string, string>, quality: CollectionOptions["musicQuality"]) =>
    quality ? { ...values, [SETTINGS.DOWNLOAD_MUSIC_QUALITY]: quality } : values;

  return {
    runs: {},

    startPlaylist: (meta, videos, options = {}) =>
      runCollection(
        "playlist",
        meta,
        options,
        videos,
        (video) => video.id,
        (video, folderPath, dbId) =>
          startVideoDownload(video, settings(), { destinationDirectory: folderPath, collectionDbId: dbId }),
      ),

    startAlbum: (meta, songs, options = {}) =>
      runCollection(
        "album",
        meta,
        options,
        songs,
        (song) => song.videoId ?? song.id,
        (song, folderPath, dbId) =>
          startMusicDownload(song, withQuality(settings(), options.musicQuality), {
            destinationDirectory: folderPath,
            collectionDbId: dbId,
            position: { number: songs.indexOf(song) + 1, total: songs.length },
            albumArtist: meta.author,
            releaseYear: meta.year,
          }),
      ),

    dismissRun: (dbId) =>
      set((state) => {
        if (!state.runs[dbId]) return {};
        const runs = { ...state.runs };
        delete runs[dbId];
        return { runs };
      }),

    handleProgress: (progress) => {
      if (!TERMINAL_STATUSES.has(progress.status)) return;
      const resolve = itemWaiters.get(progress.id);
      if (!resolve) return;
      itemWaiters.delete(progress.id);
      if (progress.collectionDbId != null) {
        bumpRun(progress.collectionDbId, progress.status === "completed" ? "completed" : "failed");
      }
      resolve();
    },
  };
});
