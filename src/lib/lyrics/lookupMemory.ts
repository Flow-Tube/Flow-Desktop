import { profileStorage } from "../storage/profileStorage";

const STORAGE_KEY = "flow_lyrics_lookups";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Oldest songs are dropped past this, so the map cannot grow without limit. */
const MAX_SONGS = 3000;

interface SongLookups {
  /** When every source last said it has nothing for this song. */
  none?: number;
  /** When the saved lyrics, without word sync, last looked for better ones. */
  looked?: number;
  /** The saved lyrics were picked or typed by hand, so nothing replaces them automatically. */
  manual?: boolean;
}

let songs: Map<string, SongLookups> | null = null;

function read(): Map<string, SongLookups> {
  if (songs) return songs;
  songs = new Map();
  try {
    const parsed: unknown = JSON.parse(profileStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [id, song] of Object.entries(parsed)) songs.set(id, song as SongLookups);
    }
  } catch {
    // What these notes save is a few requests, so losing them costs nothing.
  }
  return songs;
}

function write(id: string, song: SongLookups | null): void {
  const map = read();
  map.delete(id);
  if (song) map.set(id, song);
  while (map.size > MAX_SONGS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Kept in memory for this session.
  }
}

const within = (at: number | undefined, nowMs: number) => at !== undefined && nowMs - at < WEEK_MS;

/** Every source answered and none had this song. Never call this after a failure or a timeout. */
export function rememberNoLyrics(id: string, nowMs = Date.now()): void {
  write(id, { ...read().get(id), none: nowMs });
}

export const remembersNoLyrics = (id: string, nowMs = Date.now()): boolean => within(read().get(id)?.none, nowMs);

/** Saved lyrics without word sync look for an upgrade at most once a week. */
export const upgradeIsDue = (id: string, nowMs = Date.now()): boolean => !within(read().get(id)?.looked, nowMs);

export function markUpgradeLookDone(id: string, nowMs = Date.now()): void {
  write(id, { ...read().get(id), looked: nowMs, none: undefined });
}

export const isManual = (id: string): boolean => read().get(id)?.manual === true;

export function markManual(id: string): void {
  write(id, { manual: true });
}

export function clearManual(id: string): void {
  const song = read().get(id);
  if (song?.manual) write(id, { ...song, manual: undefined });
}

/** Refresh: the next lookup asks every source again. */
export function forgetLookups(id: string): void {
  if (read().has(id)) write(id, null);
}

/** For tests. */
export function resetLookupMemory(): void {
  songs = null;
}
