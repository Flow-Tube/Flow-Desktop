import { create } from "zustand";

import {
  acceptJoin,
  addDevice,
  askToJoin,
  answerCode,
  cancelLink,
  createGroup,
  createLanGroup,
  createWebdavGroup,
  declineJoin,
  enterCode,
  forgetGroup,
  getJoinRequests,
  getLinkPhase,
  getLinkedDevices,
  getLinkedStatus,
  markRecoverySaved,
  onLinkPhase,
  onSynced,
  removeDevice,
  renameDevice,
  restoreGroup,
  showCode,
  syncNow,
  updateLogin,
  type FolderAccess,
  type JoinRequest,
  type LinkPhase,
  type LinkedDevice,
  type LinkedStatus,
} from "../lib/api/linked";
import { normalizeBackendError } from "../lib/api/errors";
import { isTauriEnv } from "../lib/api/env";
import { receivedMessage } from "../lib/linked/receivedMessage";
import { syncErrorMessage } from "../lib/syncErrors";
import { useUiStore } from "./useUiStore";

function describe(error: unknown): string {
  const { kind, message } = normalizeBackendError(error);
  return syncErrorMessage(kind, message);
}

interface LinkedState {
  initialized: boolean;
  status: LinkedStatus | null;
  devices: LinkedDevice[] | null;
  devicesError: string | null;
  joinRequests: JoinRequest[];
  link: LinkPhase;
  /** Recovery words to show once, until the user proves they saved them. */
  words: string | null;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (url: string, adminToken: string) => Promise<void>;
  createOnLan: () => Promise<void>;
  createOnWebdav: (url: string, user: string, password: string) => Promise<void>;
  updateLogin: (user: string, password: string) => Promise<void>;
  restore: (url: string, words: string) => Promise<void>;
  enterCode: (code: string, folder?: FolderAccess) => Promise<void>;
  askToJoin: (url: string, adminToken: string) => Promise<void>;
  loadJoinRequests: () => Promise<void>;
  acceptJoin: (id: string) => Promise<void>;
  declineJoin: (id: string) => Promise<void>;
  showCode: () => Promise<void>;
  addDevice: () => Promise<void>;
  answer: (accept: boolean) => Promise<void>;
  closeLink: () => Promise<void>;
  confirmSaved: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  forget: () => Promise<void>;
  syncNow: () => Promise<void>;
}

export const useLinkedDevicesStore = create<LinkedState>((set, get) => {
  /** Runs one user action with the shared busy flag, showing its failure as `error`. */
  async function run(action: () => Promise<void>) {
    set({ busy: true, error: null });
    try {
      await action();
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  }

  async function loadDevices() {
    try {
      set({ devices: await getLinkedDevices(), devicesError: null });
    } catch (error) {
      set({ devicesError: describe(error) });
    }
  }

  return {
    initialized: false,
    status: null,
    devices: null,
    devicesError: null,
    joinRequests: [],
    link: { phase: "idle" },
    words: null,
    busy: false,
    error: null,

    init: async () => {
      if (get().initialized) return;
      set({ initialized: true });
      if (!(await isTauriEnv())) return;
      await onLinkPhase((link) => {
        set({ link });
        if (link.phase === "done") void get().refresh();
      });
      await onSynced((lastSync) => {
        const status = get().status;
        if (!status) return;
        set({ status: { ...status, lastSync } });
        if (status.kind) void loadDevices();
      });
      set({ link: await getLinkPhase() });
      await get().refresh();
    },

    refresh: async () => {
      try {
        const status = await getLinkedStatus();
        set({ status });
        if (status.kind) await loadDevices();
        else set({ devices: null, devicesError: null });
      } catch (error) {
        set({ error: describe(error) });
      }
    },

    create: (url, adminToken) =>
      run(async () => {
        set({ words: await createGroup(url, adminToken) });
        await get().refresh();
      }),

    createOnLan: () =>
      run(async () => {
        set({ words: await createLanGroup() });
        await get().refresh();
      }),

    createOnWebdav: (url, user, password) =>
      run(async () => {
        set({ words: await createWebdavGroup(url, user, password) });
        await get().refresh();
      }),

    updateLogin: (user, password) =>
      run(async () => {
        await updateLogin(user, password);
        await get().refresh();
      }),

    restore: (url, words) =>
      run(async () => {
        set({ words: await restoreGroup(url, words) });
        await get().refresh();
      }),

    enterCode: (code, folder) => run(() => enterCode(code, folder)),
    askToJoin: (url, adminToken) => run(() => askToJoin(url, adminToken)),
    // Polled while the page is open, so a failure (an older server, no network) stays quiet.
    loadJoinRequests: async () => {
      try {
        set({ joinRequests: await getJoinRequests() });
      } catch {
        set({ joinRequests: [] });
      }
    },
    acceptJoin: (id) =>
      run(async () => {
        set((state) => ({ joinRequests: state.joinRequests.filter((r) => r.id !== id) }));
        await acceptJoin(id);
      }),
    declineJoin: (id) =>
      run(async () => {
        set((state) => ({ joinRequests: state.joinRequests.filter((r) => r.id !== id) }));
        await declineJoin(id);
      }),
    showCode: () => run(showCode),
    addDevice: () => run(addDevice),
    answer: (accept) => run(() => answerCode(accept)),
    closeLink: () => run(cancelLink),

    confirmSaved: () =>
      run(async () => {
        await markRecoverySaved();
        set({ words: null });
        await get().refresh();
      }),

    rename: (id, name) =>
      run(async () => {
        await renameDevice(id, name);
        await loadDevices();
      }),

    remove: (id) =>
      run(async () => {
        await removeDevice(id);
        await loadDevices();
      }),

    forget: () =>
      run(async () => {
        await forgetGroup();
        await get().refresh();
      }),

    syncNow: () =>
      run(async () => {
        const received = await syncNow();
        const toast = useUiStore.getState().showToast;
        received.forEach((from) => toast({ message: receivedMessage(from) }));
        await get().refresh();
      }),
  };
});
