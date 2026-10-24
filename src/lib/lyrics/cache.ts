import type { LyricsEntry } from "./types";
import { evictCachedLyrics, getCachedLyrics, putCachedLyrics } from "../api/lyrics";

/**
 * Two tiers, as on Android: the last 32 songs in memory, and every song's lyrics as
 * `lyrics/<videoId>.json` in app data, which outlives a restart without filling browser storage.
 */
const MEMORY_SIZE = 32;
const memory = new Map<string, LyricsEntry[]>();

/** Where lyrics were kept before they moved to app data. */
const LEGACY_PREFIX = "flow_lyrics_";

export function getMemory(id: string): LyricsEntry[] | null {
  const entries = memory.get(id);
  if (!entries) return null;
  // Re-inserting keeps the map in least recently used order.
  memory.delete(id);
  memory.set(id, entries);
  return entries;
}

export function setMemory(id: string, entries: LyricsEntry[]): void {
  memory.delete(id);
  memory.set(id, entries);
  while (memory.size > MEMORY_SIZE) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function parseEntries(raw: string | null): LyricsEntry[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LyricsEntry[]) : null;
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
      keys = Object.keys(localStorage).filter((key) => key.startsWith(LEGACY_PREFIX));
    } catch {
      return;
    }
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw && parseEntries(raw)) await putCachedLyrics(key.slice(LEGACY_PREFIX.length), raw);
      } catch {
        // An entry that cannot move is dropped with the rest.
      }
      try {
        localStorage.removeItem(key);
      } catch {
        return;
      }
    }
  })();
  return migration;
}

export async function getDisk(id: string): Promise<LyricsEntry[] | null> {
  await migrateLegacyCache();
  try {
    return parseEntries(await getCachedLyrics(id));
  } catch {
    return null;
  }
}

export function setDisk(id: string, entries: LyricsEntry[]): void {
  void putCachedLyrics(id, JSON.stringify(entries)).catch(() => {});
}

export function evict(id: string): void {
  memory.delete(id);
  void evictCachedLyrics(id).catch(() => {});
}

export function clearMemory(): void {
  memory.clear();
}
