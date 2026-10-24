import { useCallback, useEffect, useState } from "react";

import { clearLyricsCache, lyricsCacheSize } from "../api/lyrics";
import { clearMemory, migrateLegacyCache } from "./cache";

/** Lyrics files run to a few kilobytes each, so the size reads in KB until it reaches a megabyte. */
export function formatCacheSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The lyrics cache's size on disk, and a way to empty it, for Settings. */
export function useLyricsCache() {
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);

  const measure = useCallback(async () => {
    try {
      await migrateLegacyCache();
      setSizeBytes(await lyricsCacheSize());
    } catch {
      setSizeBytes(null);
    }
  }, []);

  useEffect(() => {
    void measure();
  }, [measure]);

  const clear = useCallback(async () => {
    setClearing(true);
    setFailed(false);
    try {
      await clearLyricsCache();
      clearMemory();
    } catch {
      setFailed(true);
    } finally {
      setClearing(false);
      void measure();
    }
  }, [measure]);

  return { sizeBytes, clearing, failed, clear };
}
