import { create } from "zustand";

import {
  acceptJoin,
  addDevice,
  askToJoin,
  answerCode,
  cancelLink,
  cancelLoginChange,
  createGroup,
  createLanGroup,
  createWebdavGroup,
  declineJoin,
  enterCode,
  finishLoginChange,
  forgetGroup,
  getJoinRequests,
  getLinkPhase,
  getLinkedDevices,
  getLinkedStatus,
  keepSide,
  leaveGroup,
  markRecoverySaved,
  onLinkPhase,
  onSynced,
  answerRecoveryNotice,
  removeDevice,
  renameDevice,
  previewRestore,
  replaceRecovery,
  restoreGroup,
  retryKeychain,
  showCode,
  startLoginChange,
  syncNow,
  updateLogin,
  type FolderAccess,
  type JoinRequest,
  type LinkPhase,
  type LinkedDevice,
  type LinkedStatus,
  type RestoreDevice,
  type WebdavLogin,
} from "../lib/api/linked";
import { forgetAfterFailedLeave } from "../lib/linked/leaveFirst";
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
  /** The devices a restore is asking about; null when it isn't asking. */
  restoreDevices: RestoreDevice[] | null;
  /** Creating a group found the server already holds one. */
  serverTaken: boolean;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (url: string, adminToken: string, resetServer?: boolean) => Promise<void>;
  createOnLan: () => Promise<void>;
  createOnWebdav: (url: string, user: string, password: string) => Promise<void>;
  updateLogin: (user: string, password: string) => Promise<void>;
  startLoginChange: (user: string, password: string) => Promise<void>;
  finishLoginChange: () => Promise<void>;
  cancelLoginChange: () => Promise<void>;
  retryKeychain: () => Promise<void>;
  /** Asks which of the group's devices the user keeps, before anything is written. */
  previewRestore: (url: string, words: string, login?: WebdavLogin) => Promise<void>;
  cancelRestore: () => void;
  /** Restores from a Flow server, or with `login` from a WebDAV folder, keeping only `kept`. */
  restore: (url: string, words: string, login: WebdavLogin | undefined, kept: string[]) => Promise<void>;
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
  /** Replaces the recovery key and shows the new words. */
  replaceRecovery: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string, also?: string[]) => Promise<void>;
  answerRecoveryNotice: () => Promise<void>;
  leave: () => Promise<void>;
  forget: () => Promise<void>;
  keepSide: (entry: string) => Promise<void>;
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
    restoreDevices: null,
    serverTaken: false,
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
      // Read whole, since a sync can follow a keychain prompt answered while the page was open.
      await onSynced(() => {
        if (get().status) void get().refresh();
      });
      set({ link: await getLinkPhase() });
      await get().refresh();
    },

    refresh: async () => {
      try {
        const status = await getLinkedStatus();
        set(status.replacedWords ? { status, words: status.replacedWords } : { status });
        if (status.kind) await loadDevices();
        else set({ devices: null, devicesError: null });
      } catch (error) {
        set({ error: describe(error) });
      }
    },

    create: (url, adminToken, resetServer) =>
      run(async () => {
        try {
          set({ words: await createGroup(url, adminToken, resetServer), serverTaken: false });
        } catch (error) {
          if (normalizeBackendError(error).kind !== "linkedAlreadyClaimed") throw error;
          set({ serverTaken: true });
          return;
        }
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

    startLoginChange: (user, password) =>
      run(async () => {
        await startLoginChange(user, password);
        await get().refresh();
      }),

    finishLoginChange: () =>
      run(async () => {
        await finishLoginChange();
        await get().refresh();
      }),

    cancelLoginChange: () =>
      run(async () => {
        await cancelLoginChange();
        await get().refresh();
      }),

    retryKeychain: () =>
      run(async () => {
        await retryKeychain();
        await get().refresh();
      }),

    previewRestore: (url, words, login) =>
      run(async () => {
        set({ restoreDevices: await previewRestore(url, words, login) });
      }),

    cancelRestore: () => set({ restoreDevices: null, error: null }),

    restore: (url, words, login, kept) =>
      run(async () => {
        set({ words: await restoreGroup(url, words, login, kept), restoreDevices: null });
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

    replaceRecovery: () =>
      run(async () => {
        set({ words: await replaceRecovery() });
        await get().refresh();
      }),

    rename: (id, name) =>
      run(async () => {
        await renameDevice(id, name);
        await loadDevices();
      }),

    remove: (id, also) =>
      run(async () => {
        const words = await removeDevice(id, also);
        if (words) set({ words });
        await loadDevices();
      }),

    answerRecoveryNotice: () =>
      run(async () => {
        await answerRecoveryNotice();
      }),

    leave: () =>
      run(async () => {
        try {
          await leaveGroup();
        } catch (error) {
          if (!(await forgetAfterFailedLeave(error))) throw error;
        }
        await get().refresh();
      }),

    forget: () =>
      run(async () => {
        await forgetGroup();
        await get().refresh();
      }),

    keepSide: (entry) =>
      run(async () => {
        await keepSide(entry);
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
