import { getString, type StringKey } from "./i18n/index";

// Mirrors `SyncError::kind` in src-tauri/src/sync/error.rs.
const SYNC_ERROR_KEYS: Record<string, StringKey> = {
  syncExpired: "sync_error_expired",
  syncInvalidCode: "sync_error_invalid_code",
  syncInvalidAddress: "sync_error_invalid_address",
  syncNoPeer: "sync_error_no_peer",
  syncBusy: "sync_error_busy",
  syncUnreachable: "sync_error_unreachable",
  syncPeerClosed: "sync_error_peer_closed",
  syncTimeout: "sync_error_timeout",
  syncCodeRejected: "sync_error_code_rejected",
  syncUnsupportedVersion: "sync_error_unsupported_version",
  syncCorrupted: "sync_error_corrupted",
  syncApplyFailed: "sync_error_apply_failed",
  syncProtocol: "sync_error_protocol",
};

/** The actionable, translated message for a sync failure, falling back to the backend's text. */
export function syncErrorMessage(kind: string | null | undefined, detail: string | null | undefined): string {
  if (kind === "syncPeerError") {
    return getString("sync_error_peer", detail ?? "");
  }
  const key = kind ? SYNC_ERROR_KEYS[kind] : undefined;
  if (key) return getString(key);
  return detail || getString("sync_failed_body");
}

/** Pasted text that is a device address (`192.168.1.4:40123`) rather than the connection data. */
export function looksLikeAddress(text: string): boolean {
  return /^\[?[0-9a-f.:]+\]?:\d{2,5}$/i.test(text.trim());
}
