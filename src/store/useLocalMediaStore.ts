import { create } from "zustand";

import {
  addLocalMediaFolder,
  cancelLocalMediaScan,
  excludeLocalMediaFolder,
  getLocalMediaLibrary,
  onLocalScanStatus,
  removeLocalMediaFolder,
  rescanLocalMedia,
  saveLocalPlayback,
  type LocalMediaFile,
  type LocalMediaFolder,
  type LocalMediaKind,
  type LocalMediaPlay,
  type LocalScanStatus,
} from "../lib/api/localMedia";
import { DEFAULT_LOCAL_FILTERS, type LocalFilters } from "../lib/localMedia/filters";

export type LocalView = "all" | "folders";

/** While a scan runs the list refreshes this often, so a long first scan fills in as it goes. */
const REFRESH_DURING_SCAN_MS = 5_000;

const IDLE_SCAN: LocalScanStatus = { running: false, done: 0, total: 0, truncated: false, failed: false };

interface LocalMediaState {
  loaded: boolean;
  loadError: boolean;
  files: LocalMediaFile[];
  folders: LocalMediaFolder[];
  plays: ReadonlyMap<string, LocalMediaPlay>;
  scan: LocalScanStatus;

  // What the viewer has chosen to look at; kept so coming back from the player finds it unchanged.
  kind: LocalMediaKind;
  view: LocalView;
  openFolder: string | null;
  filters: LocalFilters;

  load: () => Promise<void>;
  rescan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  addFolder: (title: string, exclude: boolean) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  excludeFolder: (path: string) => Promise<void>;
  notePlayback: (id: string, positionSeconds: number, durationSeconds: number) => void;
  setKind: (kind: LocalMediaKind) => void;
  setView: (view: LocalView) => void;
  setOpenFolder: (path: string | null) => void;
  updateFilters: (change: Partial<LocalFilters>) => void;
  resetFilters: () => void;
}

let listening = false;
let lastRefreshAt = 0;

export const useLocalMediaStore = create<LocalMediaState>((set, get) => {
  const listenForScans = () => {
    if (listening) return;
    listening = true;
    void onLocalScanStatus((scan) => {
      const finished = get().scan.running && !scan.running;
      set({ scan });
      const now = Date.now();
      if (finished || (scan.running && now - lastRefreshAt > REFRESH_DURING_SCAN_MS)) {
        lastRefreshAt = now;
        void get().load();
      }
    }).catch(() => {
      listening = false;
    });
  };

  return {
    loaded: false,
    loadError: false,
    files: [],
    folders: [],
    plays: new Map(),
    scan: IDLE_SCAN,

    kind: "video",
    view: "all",
    openFolder: null,
    filters: DEFAULT_LOCAL_FILTERS,

    load: async () => {
      listenForScans();
      try {
        const library = await getLocalMediaLibrary();
        set({
          loaded: true,
          loadError: false,
          files: library.files,
          folders: library.folders,
          plays: new Map(library.plays.map((play) => [play.fileId, play])),
          scan: library.scan,
        });
      } catch (error) {
        console.warn("Failed to read the local media library", error);
        set({ loaded: true, loadError: true });
      }
    },

    rescan: async () => {
      listenForScans();
      set({ scan: { ...IDLE_SCAN, running: true } });
      await rescanLocalMedia().catch(() => set({ scan: { ...IDLE_SCAN, failed: true } }));
    },

    cancelScan: async () => {
      await cancelLocalMediaScan();
    },

    addFolder: async (title, exclude) => {
      listenForScans();
      const added = await addLocalMediaFolder(title, exclude);
      if (added) await get().load();
    },

    removeFolder: async (path) => {
      const previous = get().folders;
      set({ folders: previous.filter((folder) => folder.path !== path) });
      try {
        await removeLocalMediaFolder(path);
        await get().load();
      } catch (error) {
        set({ folders: previous });
        throw error;
      }
    },

    excludeFolder: async (path) => {
      const previous = get().files;
      set({
        files: previous.filter((file) => file.folderPath !== path && !file.folderPath.startsWith(`${path}/`)),
        openFolder: get().openFolder === path ? null : get().openFolder,
      });
      try {
        await excludeLocalMediaFolder(path);
        await get().load();
      } catch (error) {
        set({ files: previous });
        throw error;
      }
    },

    notePlayback: (id, positionSeconds, durationSeconds) => {
      const play: LocalMediaPlay = {
        fileId: id,
        positionMs: Math.round(positionSeconds * 1000),
        durationMs: Math.round(durationSeconds * 1000),
        lastPlayedMs: Date.now(),
      };
      const previous = get().plays;
      const plays = new Map(previous);
      plays.set(id, play);
      set({ plays });
      void saveLocalPlayback(id, positionSeconds, durationSeconds).catch((error) => {
        console.warn("Failed to save a local file's position", error);
        set({ plays: previous });
      });
    },

    setKind: (kind) => set({ kind, openFolder: null }),
    setView: (view) => set({ view, openFolder: null }),
    setOpenFolder: (openFolder) => set({ openFolder }),
    updateFilters: (change) => set({ filters: { ...get().filters, ...change } }),
    resetFilters: () => set({ filters: { ...DEFAULT_LOCAL_FILTERS, query: get().filters.query } }),
  };
});
