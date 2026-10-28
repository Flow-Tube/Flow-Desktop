import { create } from "zustand";

import {
  cancelSync,
  getSyncDeviceInfo,
  getSyncStatus,
  onSyncStatus,
  respondSyncConsent,
  scanSyncJoin,
  startSyncHost,
  startSyncHostReceive,
  type DeviceInfo,
  type HostStartInfo,
  type SyncStatus,
} from "../lib/api/sync";
import { getBackendErrorMessage, normalizeBackendError } from "../lib/api/errors";
import { syncErrorMessage } from "../lib/syncErrors";
import { isTauriEnv } from "../lib/api/env";

const IDLE_STATUS: SyncStatus = { phase: "idle" };

function describeSyncError(error: unknown): string {
  const { kind, message } = normalizeBackendError(error);
  return syncErrorMessage(kind, message);
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
        patch.error = syncErrorMessage(status.errorKind, status.message);
      }
      set(patch);
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
      set({ busy: false, error: describeSyncError(error) });
    }
  },

  hostReceive: async () => {
    set({ busy: true, error: null, hostInfo: null });
    try {
      const hostInfo = await startSyncHostReceive();
      set({ hostInfo, busy: false });
    } catch (error) {
      set({ busy: false, error: describeSyncError(error) });
    }
  },

  join: async (qr) => {
    set({ busy: true, error: null });
    try {
      await scanSyncJoin(qr.trim());
      set({ busy: false });
    } catch (error) {
      set({ busy: false, error: describeSyncError(error) });
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
