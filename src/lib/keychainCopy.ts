import type { KeychainProblem } from "./api/linked";
import type { StringKey } from "./i18n/index";
import { IS_LINUX_RUNTIME, IS_MACOS_RUNTIME } from "./platform";

export type KeychainPlatform = "macos" | "linux" | "windows";

export const KEYCHAIN_PLATFORM: KeychainPlatform = IS_MACOS_RUNTIME ? "macos" : IS_LINUX_RUNTIME ? "linux" : "windows";

/** The title and advice for a keychain that hasn't given Sync this device's keys, in each system's words. */
export function keychainCopy(
  problem: KeychainProblem,
  platform: KeychainPlatform = KEYCHAIN_PLATFORM,
): { title: StringKey; body: StringKey } {
  if (problem === "unavailable") {
    return {
      title: "linked_keychain_title_missing",
      body: platform === "linux" ? "linked_keychain_unavailable_linux" : "linked_keychain_unavailable",
    };
  }
  const title = "linked_keychain_title";
  if (problem === "failed") return { title, body: "linked_keychain_failed" };
  if (platform === "macos") return { title, body: "linked_keychain_macos" };
  if (problem === "waiting") return { title, body: "linked_keychain_waiting" };
  return { title, body: platform === "linux" ? "linked_keychain_locked_linux" : "linked_keychain_locked" };
}
