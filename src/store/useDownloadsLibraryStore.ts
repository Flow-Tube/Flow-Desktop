import { create } from "zustand";

import { getPlural, getString } from "../lib/i18n/index";
import { onBeforeProfileSwitch } from "../lib/profiles/beforeSwitch";
import { useUiStore } from "./useUiStore";
import {
  clearDownloads,
  deleteDownloads,
  getDownloadedVideoIds,
  listDownloads,
  type DownloadRecord,
} from "../lib/api/downloads";

interface DownloadsLibraryState {
  records: DownloadRecord[];
  downloadedIds: Set<string>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
  remove: (ids: number[]) => Promise<void>;
  /**
   * Takes downloads off every list now and offers Undo; the files go once that passes. A newer
   * delete finishes the one before it first.
   */
  removeWithUndo: (ids: number[]) => void;
  clear: () => Promise<void>;
}

let loadInFlight: Promise<void> | null = null;

/** Long enough to reach the toast's Undo, which stays up as long. */
export const DOWNLOAD_UNDO_MS = 8_000;
/** Waiting out their Undo: still on disk and in the database, gone from every list. */
let awaitingDelete = new Set<number>();
let deleteTimer: ReturnType<typeof setTimeout> | null = null;
let flushesOnExit = false;

/** The toast already said deleted, so leaving inside the Undo window still deletes. */
function flushOnExit() {
  if (flushesOnExit) return;
  flushesOnExit = true;
  window.addEventListener("beforeunload", finishAwaitingDelete);
  onBeforeProfileSwitch(finishAwaitingDelete);
}

function withoutAwaitingDelete(records: DownloadRecord[], ids: string[]) {
  const shown = records.filter((record) => !awaitingDelete.has(record.id));
  const hiddenVideos = records.filter((record) => awaitingDelete.has(record.id)).map((record) => record.videoId);
  const stillShown = new Set(shown.map((record) => record.videoId));
  const leaving = new Set(hiddenVideos.filter((videoId) => videoId !== null && !stillShown.has(videoId)));
  return { records: shown, downloadedIds: new Set(ids.filter((id) => !leaving.has(id))) };
}

export const useDownloadsLibraryStore = create<DownloadsLibraryState>((set, get) => ({
  records: [],
  downloadedIds: new Set(),
  loaded: false,
  loading: false,
  load: async () => {
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      set({ loading: true });
      try {
        const [records, ids] = await Promise.all([listDownloads(), getDownloadedVideoIds()]);
        set({ ...withoutAwaitingDelete(records, ids), loaded: true });
      } catch (error) {
        console.warn("Failed to load the downloads library", error);
      } finally {
        set({ loading: false });
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  },
  ensureLoaded: async () => {
    if (get().loaded) return;
    await get().load();
  },
  remove: async (ids) => {
    if (ids.length === 0) return;
    await deleteDownloads(ids);
    await get().load();
  },
  removeWithUndo: (ids) => {
    if (ids.length === 0) return;
    finishAwaitingDelete();
    flushOnExit();
    awaitingDelete = new Set(ids);
    set((state) => withoutAwaitingDelete(state.records, [...state.downloadedIds]));
    deleteTimer = setTimeout(finishAwaitingDelete, DOWNLOAD_UNDO_MS);
    useUiStore.getState().showToast({
      variant: "success",
      message: getPlural("downloads_deleted", ids.length),
      durationMs: DOWNLOAD_UNDO_MS,
      actions: [{
        label: getString("undo"),
        onSelect: () => {
          if (deleteTimer) clearTimeout(deleteTimer);
          deleteTimer = null;
          awaitingDelete = new Set();
          void get().load();
        },
      }],
    });
  },
  clear: async () => {
    finishAwaitingDelete();
    await clearDownloads();
    set({ records: [], downloadedIds: new Set() });
  },
}));

function finishAwaitingDelete(): Promise<void> | undefined {
  if (deleteTimer) clearTimeout(deleteTimer);
  deleteTimer = null;
  const ids = [...awaitingDelete];
  if (ids.length === 0) return undefined;
  awaitingDelete = new Set();
  return deleteDownloads(ids).catch((error) => {
    console.error("Failed to delete downloads", error);
    useUiStore.getState().showToast({ variant: "error", message: getString("downloads_delete_failed") });
    void useDownloadsLibraryStore.getState().load();
  });
}
