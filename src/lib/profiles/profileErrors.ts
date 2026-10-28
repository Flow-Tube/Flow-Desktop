import { normalizeBackendError } from "../api/errors";
import { getString, type StringKey } from "../i18n/index";

// Mirrors the profile kinds of `AppError` in src-tauri/src/errors/mod.rs; for the two that carry
// a reason, the backend message is that reason.
const REASONS: Record<string, StringKey> = {
  "profileName:blank": "profiles_name_blank",
  "profileName:tooLong": "profiles_name_too_long",
  "profileName:taken": "profiles_name_taken",
  "profileSwitchRefused:syncRunning": "profiles_switch_refused_sync",
  "profileSwitchRefused:switching": "profiles_switch_refused_switching",
  "profileSwitchRefused:alreadyActive": "profiles_switch_refused_active",
};

const KINDS: Record<string, StringKey> = {
  profileLimit: "profiles_limit_reached",
  profileNotFound: "profiles_not_found",
  profileInUse: "profiles_delete_in_use",
  profileCopyFailed: "profiles_copy_failed",
};

/** The message to show for a failed profile action. */
export function profileErrorMessage(error: unknown, fallback: StringKey): string {
  const { kind, message } = normalizeBackendError(error);
  const key = REASONS[`${kind}:${message}`] ?? KINDS[kind] ?? fallback;
  return key === "profiles_limit_reached" ? getString(key, 5) : getString(key);
}
