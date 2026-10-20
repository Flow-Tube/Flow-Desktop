import type { StringKey } from "./i18n/index";

export type UpdateBlockReason = "flatpak" | "package-manager" | "unbundled";

export interface UpdateSupport {
  supported: boolean;
  reason: UpdateBlockReason | null;
}

const BLOCK_REASONS: readonly UpdateBlockReason[] = ["flatpak", "package-manager", "unbundled"];

/**
 * Reads the backend's `updates_supported` payload. Anything unexpected counts as
 * supported: the backend never registers the updater for a blocked install, so
 * the worst case is a check that fails with the usual error toast.
 */
export function parseUpdateSupport(value: unknown): UpdateSupport {
  if (typeof value !== "object" || value === null) return { supported: true, reason: null };
  const { supported, reason } = value as Record<string, unknown>;
  const knownReason = BLOCK_REASONS.find((candidate) => candidate === reason) ?? null;
  if (supported === false && knownReason) return { supported: false, reason: knownReason };
  return { supported: true, reason: null };
}

export function updateBlockedStringKey(reason: UpdateBlockReason): StringKey {
  switch (reason) {
    case "flatpak":
      return "settings_updates_managed_flatpak";
    case "package-manager":
      return "settings_updates_managed_package_manager";
    case "unbundled":
      return "settings_updates_unbundled";
  }
}
