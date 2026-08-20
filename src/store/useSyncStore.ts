import { create } from "zustand";

import {
  cancelSync,
  getSyncDeviceInfo,
  getSyncStatus,
  onSyncRefresh,
  onSyncStatus,
  respondSyncConsent,
  scanSyncJoin,
  startSyncHost,
  startSyncHostReceive,
  type DeviceInfo,
  type HostStartInfo,
  type SyncStatus,
} from "../lib/api/sync";
import { getBackendErrorMessage } from "../lib/api/errors";
import { isTauriEnv } from "../lib/api/env";
import { LIKES_LIBRARY_UPDATED_EVENT, useLikesStore } from "./useLikesStore";
import { useAppSettingsStore } from "./useAppSettingsStore";
import { useAlbumLibraryStore } from "./useAlbumLibraryStore";
import { useSubscriptionStore } from "./useSubscriptionStore";
import { PLAYLIST_LIBRARY_UPDATED_EVENT } from "../lib/playlistLibrary";

const IDLE_STATUS: SyncStatus = { phase: "idle" };

/// Reload the Zustand-cached frontend stores after a merge wrote the DB directly.
async function applyRefresh(collections: string[]) {
  try {
    if (collections.includes("likes")) {
      useLikesStore.setState({ loaded: false });
      await useLikesStore.getState().load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(LIKES_LIBRARY_UPDATED_EVENT));
      }
    }
    if (collections.includes("settings")) {
      await useAppSettingsStore.getState().loadSettings();
    }
    if (collections.includes("playlists")) {
      await useAlbumLibraryStore.getState().load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(PLAYLIST_LIBRARY_UPDATED_EVENT));
      }
    }
    if (collections.includes("subscribed_channels")) {
      await useSubscriptionStore.getState().loadSubscriptions();
    }
    if (collections.includes("subscriptions")) {
      await useSubscriptionStore.getState().loadSubscriptionGroups();
    }
  } catch (error) {
    console.warn("Failed to refresh local stores after sync", error);
  }
}

interface SyncState {
  initialized: boolean;
  device: DeviceInfo | null;
  status: SyncStatus;
  hostInfo: HostStartInfo | null;
  error: string | null;
  busy: boolean;

  init: () => Promise<void>;
  startHost: (collections: string[]) => Promise<void>;
  hostReceive: () => Promise<void>;
  join: (qr: string) => Promise<void>;
  respondConsent: (accept: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  /// Clear a finished session locally (idle/completed/declined/error) back to the start screen.
  reset: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  initialized: false,
  device: null,
  status: IDLE_STATUS,
  hostInfo: null,
  error: null,
  busy: false,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    if (!(await isTauriEnv())) return;

    await onSyncStatus((status) => {
      // A fresh session supersedes any stale host QR once we leave the hosting phase.
      const patch: Partial<SyncState> = { status };
      if (status.phase !== "hosting" && status.phase !== "awaitingConsent") {
        patch.hostInfo = null;
      }
      if (status.phase === "error") {
        patch.error = status.message ?? "Sync failed";
      }
      set(patch);
    });
    await onSyncRefresh((collections) => {
      void applyRefresh(collections);
    });

    try {
      const [device, status] = await Promise.all([getSyncDeviceInfo(), getSyncStatus()]);
      set({ device, status });
    } catch (error) {
      console.warn("Failed to load sync device info", error);
    }
  },

  startHost: async (collections) => {
    set({ busy: true, error: null, hostInfo: null });
    try {
      const hostInfo = await startSyncHost(collections);
      set({ hostInfo, busy: false });
    } catch (error) {
      set({ busy: false, error: getBackendErrorMessage(error) });
    }
  },

  hostReceive: async () => {
    set({ busy: true, error: null, hostInfo: null });
    try {
      const hostInfo = await startSyncHostReceive();
      set({ hostInfo, busy: false });
    } catch (error) {
      set({ busy: false, error: getBackendErrorMessage(error) });
    }
  },

  join: async (qr) => {
    set({ busy: true, error: null });
    try {
      await scanSyncJoin(qr.trim());
      set({ busy: false });
    } catch (error) {
      set({ busy: false, error: getBackendErrorMessage(error) });
    }
  },

  respondConsent: async (accept) => {
    try {
      await respondSyncConsent(accept);
    } catch (error) {
      set({ error: getBackendErrorMessage(error) });
    }
  },

  cancel: async () => {
    try {
      await cancelSync();
    } catch (error) {
      console.warn("Failed to cancel sync", error);
    }
    set({ status: IDLE_STATUS, hostInfo: null, error: null, busy: false });
  },

  reset: async () => {
    // If a session is mid-flight, cancel it; otherwise just clear the finished result.
    const phase = get().status.phase;
    if (phase === "hosting" || phase === "connecting" || phase === "transferring" || phase === "awaitingConsent") {
      await get().cancel();
      return;
    }
    set({ status: IDLE_STATUS, hostInfo: null, error: null, busy: false });
  },
}));
