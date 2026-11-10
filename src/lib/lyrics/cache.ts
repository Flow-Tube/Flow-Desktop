import type { LyricsEntry } from "./types";
import { evictCachedLyrics, getCachedLyrics, putCachedLyrics } from "../api/lyrics";
import { profileStorage } from "../storage/profileStorage";

/**
 * Two tiers, as on Android: the last 32 songs in memory, and every song's lyrics as
 * `lyrics/<videoId>.json` in app data, which outlives a restart without filling browser storage.
 */
const MEMORY_SIZE = 32;

/** A song's lyrics and the source they came from; null for lyrics saved before the source was kept. */
export interface CachedLyrics {
  entries: LyricsEntry[];
  provider: string | null;
}

const memory = new Map<string, CachedLyrics>();

/** Where lyrics were kept before they moved to app data. */
const LEGACY_PREFIX = "flow_lyrics_";

export function getMemory(id: string): CachedLyrics | null {
  const cached = memory.get(id);
  if (!cached) return null;
  // Re-inserting keeps the map in least recently used order.
  memory.delete(id);
  memory.set(id, cached);
  return cached;
}

export function setMemory(id: string, entries: LyricsEntry[], provider: string | null): void {
  memory.delete(id);
  memory.set(id, { entries, provider });
  while (memory.size > MEMORY_SIZE) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** Reads a saved song: `{ provider, entries }`, or the bare list of entries earlier versions saved. */
function parseCached(raw: string | null): CachedLyrics | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { entries: parsed as LyricsEntry[], provider: null };
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as CachedLyrics).entries)) {
      const { entries, provider } = parsed as CachedLyrics;
      return { entries, provider: typeof provider === "string" ? provider : null };
    }
    return null;
  } catch {
    return null;
  }
}

let migration: Promise<void> | null = null;

/** Moves the entries an earlier version kept in localStorage to app data, once, and deletes them. */
export function migrateLegacyCache(): Promise<void> {
  migration ??= (async () => {
    let keys: string[] = [];
    try {
      keys = profileStorage.keys().filter((key) => key.startsWith(LEGACY_PREFIX));
    } catch {
      return;
    }
    for (const key of keys) {
      try {
        const raw = profileStorage.getItem(key);
        if (raw && parseCached(raw)) await putCachedLyrics(key.slice(LEGACY_PREFIX.length), raw);
      } catch {
        // An entry that cannot move is dropped with the rest.
      }
      try {
        profileStorage.removeItem(key);
      } catch {
        return;
      }
    }
  })();
  return migration;
}

export async function getDisk(id: string): Promise<CachedLyrics | null> {
  await migrateLegacyCache();
  try {
    return parseCached(await getCachedLyrics(id));
  } catch {
    return null;
  }
}

export function setDisk(id: string, entries: LyricsEntry[], provider: string | null): void {
  void putCachedLyrics(id, JSON.stringify({ provider, entries } satisfies CachedLyrics)).catch(() => {});
}

export function evict(id: string): void {
  memory.delete(id);
  void evictCachedLyrics(id).catch(() => {});
}

export function clearMemory(): void {
  memory.clear();
}
