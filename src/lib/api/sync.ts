import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";

// --- Wire types (mirror `src-tauri/src/sync/session.rs`, camelCase) -------------------------

export type SyncPhase =
  | "idle"
  | "hosting"
  | "connecting"
  | "awaitingConsent"
  | "transferring"
  | "completed"
  | "declined"
  | "error";

export type SyncRole = "host" | "client";
export type ConsentKind = "hostAllow" | "clientMerge";

export interface PeerInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}

export interface ManifestInfo {
  collection: string;
  recordCount: number;
  byteSize: number;
}

export interface StatInfo {
  collection: string;
  added: number;
  updated: number;
  skipped: number;
  tombstoned: number;
}

/** Why a collection stayed on both devices (backend `WithheldReason`). */
export type WithheldReason = "peerOlder" | "peerNewer" | "keyLanguage";

export interface WithheldInfo {
  collection: string;
  reason: WithheldReason;
}

export interface SyncStatus {
  phase: SyncPhase;
  role?: SyncRole | null;
  message?: string | null;
  /** For `error`: the backend `SyncError::kind`, turned into a message by `syncErrorMessage`. */
  errorKind?: string | null;
  sas?: string | null;
  peer?: PeerInfo | null;
  consentKind?: ConsentKind | null;
  manifests?: ManifestInfo[] | null;
  stats?: StatInfo[] | null;
  /** For `completed`: whether this device sent or received. */
  direction?: "sent" | "received" | null;
  /** For `completed`: collections neither device sent, because they read topics differently. */
  withheld?: WithheldInfo[] | null;
  expiresAt?: number | null;
  deviceName?: string | null;
}

export interface HostStartInfo {
  qr: string;
  sas: string;
  ip: string;
  port: number;
  expiresAt: number;
  deviceName: string;
  receive: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
}

/** What a sync can carry, in the order the Sync page lists them; the page names each one. */
export const SYNC_COLLECTIONS: ReadonlyArray<{ key: string }> = [
  { key: "watch_history" },
  { key: "playlists" },
  { key: "likes" },
  { key: "settings" },
  { key: "flow_neuro_brain" },
  { key: "music_brain" },
  { key: "subscribed_channels" },
  { key: "subscriptions" },
  { key: "notes" },
];

export const SYNC_STATUS_EVENT = "sync://status";
export const SYNC_REFRESH_EVENT = "sync://refresh";

// --- Commands -------------------------------------------------------------------------------

export function getSyncDeviceInfo(): Promise<DeviceInfo> {
  return invokeBackend<DeviceInfo>("sync_device_info");
}

export function getSyncStatus(): Promise<SyncStatus> {
  return invokeBackend<SyncStatus>("sync_status");
}

export function startSyncHost(collections: string[]): Promise<HostStartInfo> {
  return invokeBackend<HostStartInfo>("sync_start_host", { collections });
}

/** Host a session to RECEIVE: show a QR the other device scans and sends to (no camera needed). */
export function startSyncHostReceive(): Promise<HostStartInfo> {
  return invokeBackend<HostStartInfo>("sync_host_receive");
}

export function scanSyncJoin(qr: string): Promise<void> {
  return invokeBackend<void>("sync_scan_join", { qr });
}

export function respondSyncConsent(accept: boolean): Promise<boolean> {
  return invokeBackend<boolean>("sync_respond_consent", { accept });
}

export function cancelSync(): Promise<void> {
  return invokeBackend<void>("sync_cancel");
}

// --- Events ---------------------------------------------------------------------------------

export function onSyncStatus(cb: (status: SyncStatus) => void): Promise<UnlistenFn> {
  return listen<SyncStatus>(SYNC_STATUS_EVENT, (event) => cb(event.payload));
}

export function onSyncRefresh(cb: (collections: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>(SYNC_REFRESH_EVENT, (event) => cb(event.payload ?? []));
}
