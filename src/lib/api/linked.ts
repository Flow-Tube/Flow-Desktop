import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";

// Wire types mirror `src-tauri/src/sync2/{actions,service,link_task}.rs` (camelCase).

export interface LastSync {
  atMs: number;
  /** The backend `EngineError::kind` the run ended with. */
  error?: string | null;
}

export interface LinkedStatus {
  linked: boolean;
  /** The group lives on its devices and syncs on the same network, with no server. */
  onLan: boolean;
  /** The Flow server this device syncs with, for a server group. */
  storeUrl?: string | null;
  recoverySaved: boolean;
  lastSync?: LastSync | null;
}

export interface LinkedDevice {
  id: string;
  name: string;
  platform: string;
  thisDevice: boolean;
  /** Met on this network in the last few minutes. */
  nearby: boolean;
}

export type LinkPhase =
  | { phase: "idle" }
  | { phase: "asking" }
  | { phase: "waiting"; code?: string | null }
  | { phase: "confirm"; sas: string }
  | { phase: "linking" }
  | { phase: "done" }
  | { phase: "failed"; kind: string; message: string };

/** A device asking to join with the server's admin token; its name is unauthenticated. */
export interface JoinRequest {
  id: string;
  name: string;
  expires: number;
}

export const getLinkedStatus = () => invokeBackend<LinkedStatus>("linked_status");
export const getLinkedDevices = () => invokeBackend<LinkedDevice[]>("linked_devices");
export const getLinkPhase = () => invokeBackend<LinkPhase>("linked_link_phase");

/** Resolves to the recovery words, shown once. */
export const createGroup = (url: string, adminToken: string) =>
  invokeBackend<string>("linked_create", { url, adminToken });

/** Starts a group on this network, with no server. Resolves to the recovery words, shown once. */
export const createLanGroup = () => invokeBackend<string>("linked_create_lan");

/** Resolves to the new recovery words, shown once. */
export const restoreGroup = (url: string, words: string) =>
  invokeBackend<string>("linked_restore", { url, words });

export const markRecoverySaved = () => invokeBackend<void>("linked_recovery_saved");
export const renameDevice = (id: string, name: string) => invokeBackend<void>("linked_rename", { id, name });
export const removeDevice = (id: string) => invokeBackend<void>("linked_remove", { id });
export const forgetGroup = () => invokeBackend<void>("linked_forget");
export const syncNow = () => invokeBackend<string[]>("linked_sync_now");
export const addDevice = () => invokeBackend<void>("linked_add_device");
/** Answers another device's code: a member's code joins its group, a new device's code adds it. */
export const enterCode = (code: string) => invokeBackend<void>("linked_enter_code", { code });
/** Shows a code for a member on the same network to scan. */
export const showCode = () => invokeBackend<void>("linked_show_code");
/** Asks the group on `url` to let this device join; a linked device then accepts it. */
export const askToJoin = (url: string, adminToken: string) =>
  invokeBackend<void>("linked_ask_to_join", { url, adminToken });
export const getJoinRequests = () => invokeBackend<JoinRequest[]>("linked_join_requests");
export const acceptJoin = (id: string) => invokeBackend<void>("linked_accept_join", { id });
export const declineJoin = (id: string) => invokeBackend<void>("linked_decline_join", { id });
export const answerCode = (accept: boolean) => invokeBackend<void>("linked_answer", { accept });
export const cancelLink = () => invokeBackend<void>("linked_cancel");

export function onLinkPhase(cb: (phase: LinkPhase) => void): Promise<UnlistenFn> {
  return listen<LinkPhase>("sync2://link", (event) => cb(event.payload));
}

export function onJoinRequests(cb: (requests: JoinRequest[]) => void): Promise<UnlistenFn> {
  return listen<JoinRequest[]>("sync2://join-requests", (event) => cb(event.payload));
}

export function onSynced(cb: (last: LastSync) => void): Promise<UnlistenFn> {
  return listen<LastSync>("sync2://synced", (event) => cb(event.payload));
}
