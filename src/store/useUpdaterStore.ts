import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import {
  checkForAppUpdate,
  downloadAndInstallUpdate,
  getUpdateSupport,
  relaunchApp,
  type Update,
} from "../lib/api/updater";
import type { UpdateSupport } from "../lib/updateSupport";

const UPDATER_PREFS_KEY = "updater_preferences";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installed"
  | "error";

interface UpdaterPreferences {
  autoCheck: boolean;
  skippedVersion: string | null;
}

/**
 * The pending update is a live plugin handle (holds a native resource id and the
 * `downloadAndInstall` method), so it lives outside the reactive store state
 * rather than being spread into it.
 */
let pendingUpdate: Update | null = null;

interface UpdaterState {
  phase: UpdaterPhase;
  dialogOpen: boolean;
  latestVersion: string | null;
  currentVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  /** Download progress as a 0..1 fraction, or `null` when indeterminate. */
  progress: number | null;
  errorMessage: string | null;

  autoCheck: boolean;
  skippedVersion: string | null;
  prefsLoaded: boolean;
  /** `null` until the backend has said whether this install updates itself. */
  support: UpdateSupport | null;

  loadPreferences: () => Promise<void>;
  loadSupport: () => Promise<UpdateSupport>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  checkForUpdates: (
    options?: { silent?: boolean },
  ) => Promise<"available" | "uptodate" | "error" | "unsupported">;
  installUpdate: () => Promise<void>;
  skipCurrentVersion: () => Promise<void>;
  dismiss: () => void;
}

async function persistPreferences(prefs: UpdaterPreferences) {
  await setSetting(UPDATER_PREFS_KEY, JSON.stringify(prefs));
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  phase: "idle",
  dialogOpen: false,
  latestVersion: null,
  currentVersion: null,
  releaseNotes: null,
  releaseDate: null,
  progress: null,
  errorMessage: null,

  autoCheck: true,
  skippedVersion: null,
  prefsLoaded: false,
  support: null,

  loadPreferences: async () => {
    if (get().prefsLoaded) return;
    try {
      const json = await getSetting(UPDATER_PREFS_KEY);
      const prefs = json ? (JSON.parse(json) as Partial<UpdaterPreferences>) : {};
      set({
        autoCheck: prefs.autoCheck !== false,
        skippedVersion: prefs.skippedVersion ?? null,
        prefsLoaded: true,
      });
    } catch (error) {
      console.error("Failed to load updater preferences", error);
      set({ autoCheck: true, skippedVersion: null, prefsLoaded: true });
    }
  },

  loadSupport: async () => {
    const support = await getUpdateSupport();
    set({ support });
    return support;
  },

  setAutoCheck: async (enabled) => {
    set({ autoCheck: enabled });
    try {
      await persistPreferences({ autoCheck: enabled, skippedVersion: get().skippedVersion });
    } catch (error) {
      console.error("Failed to persist auto-check preference", error);
    }
  },

  checkForUpdates: async (options) => {
    const silent = options?.silent ?? false;
    const phase = get().phase;
    if (phase === "checking" || phase === "downloading") return "error";
    if (!(await get().loadSupport()).supported) return "unsupported";

    set({ phase: "checking", errorMessage: null });
    try {
      const update = await checkForAppUpdate();
      if (!update) {
        set({ phase: "idle" });
        return "uptodate";
      }

      pendingUpdate = update;

      // A silent startup check honours a version the user chose to skip; an
      // explicit manual check always surfaces the dialog.
      if (silent && get().skippedVersion === update.version) {
        set({ phase: "idle" });
        return "available";
      }

      set({
        phase: "available",
        dialogOpen: true,
        latestVersion: update.version,
        currentVersion: update.currentVersion,
        releaseNotes: update.body ?? null,
        releaseDate: update.date ?? null,
        progress: null,
        errorMessage: null,
      });
      return "available";
    } catch (error) {
      console.error("Update check failed", error);
      pendingUpdate = null;
      // Leave the dialog closed; the manual caller surfaces its own toast.
      set({ phase: "idle" });
      return "error";
    }
  },

  installUpdate: async () => {
    if (!pendingUpdate) return;
    set({ phase: "downloading", progress: null, errorMessage: null });
    try {
      await downloadAndInstallUpdate(pendingUpdate, (fraction) => set({ progress: fraction }));
      set({ phase: "installed", progress: 1 });
      // On Windows the installer closes the app itself; elsewhere we relaunch.
      await relaunchApp();
    } catch (error) {
      console.error("Update install failed", error);
      set({ phase: "error", errorMessage: String(error) });
    }
  },

  skipCurrentVersion: async () => {
    const version = get().latestVersion;
    pendingUpdate = null;
    set({ dialogOpen: false, phase: "idle", skippedVersion: version });
    try {
      await persistPreferences({ autoCheck: get().autoCheck, skippedVersion: version });
    } catch (error) {
      console.error("Failed to persist skipped version", error);
    }
  },

  dismiss: () => {
    // Never tear the dialog down mid-install.
    if (get().phase === "downloading") return;
    set({ dialogOpen: false, phase: "idle" });
  },
}));
