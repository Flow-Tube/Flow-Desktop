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

export interface SyncStatus {
  phase: SyncPhase;
  role?: SyncRole | null;
  message?: string | null;
  sas?: string | null;
  peer?: PeerInfo | null;
  consentKind?: ConsentKind | null;
  manifests?: ManifestInfo[] | null;
  stats?: StatInfo[] | null;
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

export const SYNC_COLLECTIONS: ReadonlyArray<{ key: string; label: string; description: string }> = [
  { key: "watch_history", label: "Watch history", description: "Everything you've watched, with progress" },
  { key: "playlists", label: "Playlists", description: "Your playlists and Watch Later" },
  { key: "likes", label: "Likes", description: "Liked videos and songs" },
  { key: "settings", label: "Player & UI settings", description: "Playback, content and quality preferences" },
  { key: "flow_neuro_brain", label: "Recommendation brain", description: "Your FlowNeuro taste profile" },
  { key: "music_brain", label: "Music taste", description: "Artist affinities and listening history" },
  { key: "subscribed_channels", label: "Subscriptions", description: "The channels you follow" },
  { key: "subscriptions", label: "Subscription groups", description: "The folders you sort your channels into" },
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
