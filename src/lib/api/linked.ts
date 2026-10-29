import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";

// Wire types mirror `src-tauri/src/sync2/{actions,service,link_task}.rs` (camelCase).

export interface LastSync {
  atMs: number;
  /** The backend `EngineError::kind` the run ended with. */
  error?: string | null;
}

export interface LinkedStatus {
  /** The Flow server this device syncs with; absent when it is in no group. */
  storeUrl?: string | null;
  recoverySaved: boolean;
  lastSync?: LastSync | null;
}

export interface LinkedDevice {
  id: string;
  name: string;
  platform: string;
  thisDevice: boolean;
}

export type LinkPhase =
  | { phase: "idle" }
  | { phase: "waiting"; code?: string | null }
  | { phase: "confirm"; sas: string }
  | { phase: "linking" }
  | { phase: "done" }
  | { phase: "failed"; kind: string; message: string };

export const getLinkedStatus = () => invokeBackend<LinkedStatus>("linked_status");
export const getLinkedDevices = () => invokeBackend<LinkedDevice[]>("linked_devices");
export const getLinkPhase = () => invokeBackend<LinkPhase>("linked_link_phase");

/** Resolves to the recovery words, shown once. */
export const createGroup = (url: string, adminToken: string) =>
  invokeBackend<string>("linked_create", { url, adminToken });

/** Resolves to the new recovery words, shown once. */
export const restoreGroup = (url: string, words: string) =>
  invokeBackend<string>("linked_restore", { url, words });

export const markRecoverySaved = () => invokeBackend<void>("linked_recovery_saved");
export const renameDevice = (id: string, name: string) => invokeBackend<void>("linked_rename", { id, name });
export const removeDevice = (id: string) => invokeBackend<void>("linked_remove", { id });
export const forgetGroup = () => invokeBackend<void>("linked_forget");
export const syncNow = () => invokeBackend<string[]>("linked_sync_now");
export const addDevice = () => invokeBackend<void>("linked_add_device");
export const joinGroup = (code: string) => invokeBackend<void>("linked_join", { code });
export const answerCode = (accept: boolean) => invokeBackend<void>("linked_answer", { accept });
export const cancelLink = () => invokeBackend<void>("linked_cancel");

export function onLinkPhase(cb: (phase: LinkPhase) => void): Promise<UnlistenFn> {
  return listen<LinkPhase>("sync2://link", (event) => cb(event.payload));
}

export function onSynced(cb: (last: LastSync) => void): Promise<UnlistenFn> {
  return listen<LastSync>("sync2://synced", (event) => cb(event.payload));
}
