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
  // Mirrors `EngineError::kind` in src-tauri/src/sync2/engine.rs.
  linkedInsecure: "linked_error_insecure",
  linkedUnreachable: "linked_error_unreachable",
  linkedRefused: "linked_error_refused",
  linkedInstanceChanged: "linked_error_instance_changed",
  linkedAlreadyClaimed: "linked_error_already_claimed",
  linkedStoreUnauthorized: "linked_error_store_unauthorized",
  linkedProtocol: "linked_error_protocol",
  linkedLocal: "linked_error_local",
  linkedNotLinked: "linked_error_not_linked",
  linkedRemoved: "linked_error_removed",
  linkedDeclined: "linked_error_declined",
  linkedTimedOut: "linked_error_timed_out",
  linkedWrongWords: "linked_error_wrong_words",
  linkedRecoveryUsed: "linked_error_recovery_used",
  linkedAlreadyLinked: "linked_error_already_linked",
  linkedLanUnreachable: "linked_error_lan_unreachable",
  linkedOtherFolder: "linked_error_other_folder",
};

/** The actionable, translated message for a sync failure, falling back to the backend's text. */
export function syncErrorMessage(kind: string | null | undefined, detail: string | null | undefined): string {
  if (kind === "syncPeerError") {
    return getString("sync_error_peer", detail ?? "");
  }
  if (kind === "syncNotDefaultProfile") {
    return getString("sync_error_not_default_profile", detail?.trim() || getString("profiles_default_name"));
  }
  const key = kind ? SYNC_ERROR_KEYS[kind] : undefined;
  if (key) return getString(key);
  return detail || getString("sync_failed_body");
}

/** Pasted text that is a device address (`192.168.1.4:40123`) rather than the connection data. */
export function looksLikeAddress(text: string): boolean {
  return /^\[?[0-9a-f.:]+\]?:\d{2,5}$/i.test(text.trim());
}
