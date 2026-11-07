import { profileStorage } from "../storage/profileStorage";

const STORAGE_KEY = "flow_lyrics_sync_offsets";
/** Oldest songs are dropped past this, so the map cannot grow without limit. */
const MAX_SONGS = 3000;
// A nudge is several quick clicks; only where they end is worth writing.
const SAVE_DELAY_MS = 300;

let offsets: Map<string, number> | null = null;
let pending: { id: string; ms: number; timer: ReturnType<typeof setTimeout> } | null = null;

function read(): Map<string, number> {
  if (offsets) return offsets;
  offsets = new Map();
  try {
    const parsed: unknown = JSON.parse(profileStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [id, ms] of Object.entries(parsed)) if (typeof ms === "number" && Number.isFinite(ms)) offsets.set(id, ms);
    }
  } catch {
    // A lost nudge is a few clicks to redo.
  }
  return offsets;
}

function write(id: string, ms: number | null): void {
  const map = read();
  map.delete(id);
  if (ms !== null) map.set(id, ms);
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

function dropPending(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

/**
 * The offset the user chose for this song, or null if they never nudged it. Kept apart from the
 * lyrics, so a nudge outlives a better answer, another source or Refresh.
 */
export function savedSyncOffset(id: string): number | null {
  if (pending?.id === id) return pending.ms;
  return read().get(id) ?? null;
}

export function saveSyncOffset(id: string, ms: number): void {
  if (pending && pending.id !== id) write(pending.id, pending.ms);
  dropPending();
  const timer = setTimeout(() => {
    pending = null;
    write(id, ms);
  }, SAVE_DELAY_MS);
  pending = { id, ms, timer };
}

export function clearSyncOffset(id: string): void {
  if (pending?.id === id) dropPending();
  if (read().has(id)) write(id, null);
}

/** For tests. */
export function resetSyncOffsets(): void {
  dropPending();
  offsets = null;
}
