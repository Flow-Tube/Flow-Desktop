import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";

// Wire types mirror `src-tauri/src/sync2/{actions,service,link_task}.rs` (camelCase).

export interface LastSync {
  atMs: number;
  /** The backend `EngineError::kind` the run ended with. */
  error?: string | null;
}

export interface LinkedStatus {
  /** The group this device is in: on a Flow server, in a WebDAV folder, or on its devices on the network. */
  kind: "server" | "webdav" | "lan" | null;
  /** Why syncing stopped by itself: the group shut this device out (an `EngineError::kind`). */
  stopped?: "linkedRemoved" | "linkedSignInRefused" | null;
  /** The Flow server or WebDAV folder this device syncs with. */
  storeUrl?: string | null;
  /** The WebDAV folder refused its login, so nothing syncs until a new one is entered. */
  loginRefused: boolean;
  /** The keychain hasn't given this device's keys: it waits for access, or access was refused. */
  keychainBlocked: boolean;
  recoverySaved: boolean;
  lastSync?: LastSync | null;
  /** A run is under way. */
  syncing: boolean;
}

export interface LinkedDevice {
  id: string;
  name: string;
  platform: string;
  thisDevice: boolean;
  /** Met on this network in the last few minutes. */
  nearby: boolean;
  /** When the device last synced, as the server saw it, or as this device last met it on the LAN. */
  lastSyncMs?: number | null;
}

/** Records one run applied from one device. */
export interface Received {
  name: string;
  count: number;
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

/** A profile on this computer, and the link it syncs (`src-tauri/src/sync2/profile_actions.rs`). */
export interface LocalLinkedProfile {
  id: string;
  link?: string | null;
}

/** A profile other devices sync and no profile here does. */
export interface SyncedProfile {
  link: string;
  /** Blank until a device names it. */
  name: string;
}

export interface LinkedProfiles {
  local: LocalLinkedProfile[];
  synced: SyncedProfile[];
  /** A restored device found several synced profiles: Default joins the one the user picks. */
  chooseForDefault: boolean;
}

/** The Sync page's dashboard (`src-tauri/src/sync2/dashboard.rs`). */
export interface Dashboard {
  kind: "server" | "webdav" | "lan";
  storeUrl?: string | null;
  /** What a Flow server speaks, when it answered. */
  server?: { protocols: string[]; live: boolean } | null;
  /** A Flow server's usage in bytes and objects, when it answered. */
  storage?: { used: number; quota: number; objects: number } | null;
  /** Recent sync failures, newest first: the error kind and when. */
  errors: { kind: string; atMs: number }[];
  profiles: SyncedProfileState[];
}

/** A profile that syncs here: batches waiting for it to run, and this device's last snapshot. */
export interface SyncedProfileState {
  profile: string;
  link: string;
  kept: number;
  ownSnapshotMs?: number | null;
}

export const getLinkedStatus = () => invokeBackend<LinkedStatus>("linked_status");
export const getDashboard = () => invokeBackend<Dashboard>("linked_dashboard");
export const getLinkedProfiles = () => invokeBackend<LinkedProfiles>("linked_profiles");
/** Syncs `profile` under a link of its own, or joining `link`. */
export const syncProfile = (profile: string, link: string | null) =>
  invokeBackend<void>("linked_sync_profile", { profile, link });
/** Links `profile`, just created for `link`, another device's profile. */
export const syncAddedProfile = (profile: string, link: string) =>
  invokeBackend<void>("linked_sync_added_profile", { profile, link });
export const stopProfile = (profile: string) => invokeBackend<void>("linked_stop_profile", { profile });
/** Stops `link` syncing on every device; each keeps its data. */
export const deleteSyncedProfile = (link: string) => invokeBackend<void>("linked_delete_profile", { link });
/** A restored device's Default joins `link`, or starts its own with `null`. */
export const chooseProfile = (link: string | null) => invokeBackend<void>("linked_choose_profile", { link });
export const getLinkedDevices = () => invokeBackend<LinkedDevice[]>("linked_devices");
export const getLinkPhase = () => invokeBackend<LinkPhase>("linked_link_phase");

/** Resolves to the recovery words, shown once. */
/** With `resetServer`, first deletes the group the server holds, for every device. */
export const createGroup = (url: string, adminToken: string, resetServer = false) =>
  invokeBackend<string>("linked_create", { url, adminToken, resetServer });

/** Starts a group on this network, with no server. Resolves to the recovery words, shown once. */
export const createLanGroup = () => invokeBackend<string>("linked_create_lan");

/** Starts a group in a WebDAV folder. Resolves to the recovery words, shown once. */
export const createWebdavGroup = (url: string, user: string, password: string) =>
  invokeBackend<string>("linked_create_webdav", { url, user, password });

/** Replaces a WebDAV login the folder refused. */
export const updateLogin = (user: string, password: string) =>
  invokeBackend<void>("linked_update_login", { user, password });

/** Resolves to the new recovery words, shown once. */
export const restoreGroup = (url: string, words: string, login?: WebdavLogin) =>
  invokeBackend<string>("linked_restore", { url, words, login: login ?? null });

export const markRecoverySaved = () => invokeBackend<void>("linked_recovery_saved");
/** Asks the keychain again after it refused, and resolves once it answered. */
export const retryKeychain = () => invokeBackend<void>("linked_retry_keychain");
export const renameDevice = (id: string, name: string) => invokeBackend<void>("linked_rename", { id, name });
export const removeDevice = (id: string) => invokeBackend<void>("linked_remove", { id });
/** Tells the group this device leaves, then forgets the group and this device's keys. */
export const leaveGroup = () => invokeBackend<void>("linked_leave");
/** Forgets the group and this device's keys without telling the group. */
export const forgetGroup = () => invokeBackend<void>("linked_forget");
/** Resolves to what the run applied, by device. */
export const syncNow = () => invokeBackend<Received[]>("linked_sync_now");
export const addDevice = () => invokeBackend<void>("linked_add_device");
/** Answers another device's code: a member's code joins its group, a new device's code adds it. */
/** The user name and password of a WebDAV folder. */
export interface WebdavLogin {
  user: string;
  password: string;
}

/** A WebDAV folder and its login, entered before scanning so pairing can use the folder's mailbox. */
export interface FolderAccess extends WebdavLogin {
  url: string;
}

export const enterCode = (code: string, folder?: FolderAccess) =>
  invokeBackend<void>("linked_enter_code", { code, folder: folder ?? null });
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

export function onSyncing(cb: () => void): Promise<UnlistenFn> {
  return listen("sync2://syncing", () => cb());
}

export function onSynced(cb: (last: LastSync) => void): Promise<UnlistenFn> {
  return listen<LastSync>("sync2://synced", (event) => cb(event.payload));
}
