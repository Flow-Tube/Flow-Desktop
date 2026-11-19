import type { HomeAppend, HomeSnapshot, HomeStatus } from "./api/homeFeed";
import { reuseById, reuseIfSame } from "./reuseItems";

// How the page takes the three kinds of change Home's backend sends (see
// src-tauri/src/services/home_feed/mod.rs). A card that did not change keeps its object, and a
// list that did not change keeps its array, so the memoized cards and grid skip the update.

/** A whole snapshot: a first load, a refresh, or cards placed or removed in the middle. */
export function acceptSnapshot(current: HomeSnapshot, next: HomeSnapshot): HomeSnapshot {
  if (next.generation < current.generation) return current;
  return {
    ...next,
    cards: reuseById(current.cards, next.cards),
    origins: reuseIfSame(current.origins, next.origins),
  };
}

const STATUS_KEYS = ["loading", "loadingMore", "hasMore", "loadMoreFailed", "error"] as const;

/** The flags alone. Those of another load are ignored, and unchanged ones change nothing. */
export function acceptStatus(current: HomeSnapshot, status: HomeStatus): HomeSnapshot {
  if (status.generation !== current.generation) return current;
  if (STATUS_KEYS.every((key) => current[key] === status[key])) return current;
  const { loading, loadingMore, hasMore, loadMoreFailed, error } = status;
  return { ...current, loading, loadingMore, hasMore, loadMoreFailed, error };
}

/**
 * A page added at the end. Null when it does not follow what the page holds (an event was
 * missed), which means the whole snapshot has to be asked for again.
 */
export function acceptAppend(current: HomeSnapshot, append: HomeAppend): HomeSnapshot | null {
  if (append.generation < current.generation) return current;
  if (append.generation > current.generation || append.start !== current.cards.length) return null;
  const { start: _start, cards, origins, ...status } = append;
  return {
    ...current,
    ...status,
    cards: [...current.cards, ...cards],
    origins: { ...current.origins, ...origins },
  };
}
