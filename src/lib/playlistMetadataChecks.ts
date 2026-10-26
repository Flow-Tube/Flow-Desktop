import { getSetting, setSetting } from "./api/db";

/**
 * Tracks whose details could not be filled in: removed or private videos, and ones that came back
 * still missing a field (a premiere has no length yet). Each is left alone for a week, so they
 * don't take the per-visit budget from tracks that can still be completed. A track that was
 * filled in is not recorded, so one a sync later resets to a stub is looked up again.
 */
const SETTING_KEY = "playlist_metadata_checks";
export const METADATA_CHECK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHECKS = 5000;

let checks: Promise<Map<string, number>> | null = null;

function load(): Promise<Map<string, number>> {
  checks ??= getSetting(SETTING_KEY)
    .then((raw) => new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, number>) : {})))
    .catch(() => new Map<string, number>());
  return checks;
}

/** The checks still within their cooldown, newest kept when there are too many. */
export function pruneChecks(all: Map<string, number>, now: number): Map<string, number> {
  const live = [...all].filter(([, at]) => now - at < METADATA_CHECK_COOLDOWN_MS);
  live.sort((a, b) => b[1] - a[1]);
  return new Map(live.slice(0, MAX_CHECKS));
}

export async function recentlyCheckedIds(now = Date.now()): Promise<Set<string>> {
  return new Set(pruneChecks(await load(), now).keys());
}

export async function rememberChecks(ids: string[], now = Date.now()): Promise<void> {
  if (ids.length === 0) return;
  const all = await load();
  for (const id of ids) all.set(id, now);
  const kept = pruneChecks(all, now);
  checks = Promise.resolve(kept);
  try {
    await setSetting(SETTING_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch (error) {
    console.warn("Failed to remember checked playlist tracks", error);
  }
}
