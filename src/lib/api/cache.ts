import { invokeBackend } from "./errors";

export type CacheKind = "artwork" | "lyrics" | "network";

export interface CacheRow {
  kind: CacheKind;
  bytes: number;
  /** Megabytes; 0 means no limit. */
  limitMb: number;
}

export interface CacheUsage {
  rows: CacheRow[];
  /** The artwork cache empties at the next start, so its size won't change until then. */
  artworkClearPending: boolean;
}

export function getCacheUsage(): Promise<CacheUsage> {
  return invokeBackend<CacheUsage>("cache_usage");
}

export function clearCache(kind: CacheKind): Promise<void> {
  return invokeBackend<void>("clear_cache", { kind });
}

export function setCacheLimit(kind: CacheKind, limitMb: number): Promise<void> {
  return invokeBackend<void>("set_cache_limit", { kind, limitMb });
}
