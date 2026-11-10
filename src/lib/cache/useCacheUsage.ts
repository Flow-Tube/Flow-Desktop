import { useCallback, useEffect, useState } from "react";

import { clearCache, getCacheUsage, setCacheLimit, type CacheKind, type CacheUsage } from "../api/cache";
import { clearMemory } from "../lyrics/cache";

/** Each cache's size and limit, with Clear and a limit change that rolls back if it can't be saved. */
export function useCacheUsage() {
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  const [busy, setBusy] = useState<CacheKind | null>(null);

  const refresh = useCallback(async () => {
    setUsage(await getCacheUsage().catch(() => null));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = useCallback(
    async (kind: CacheKind): Promise<boolean> => {
      setBusy(kind);
      try {
        await clearCache(kind);
        if (kind === "lyrics") clearMemory();
        return true;
      } catch {
        return false;
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [refresh],
  );

  const changeLimit = useCallback(
    async (kind: CacheKind, limitMb: number): Promise<boolean> => {
      setUsage((current) =>
        current && { ...current, rows: current.rows.map((row) => (row.kind === kind ? { ...row, limitMb } : row)) },
      );
      setBusy(kind);
      try {
        await setCacheLimit(kind, limitMb);
        return true;
      } catch {
        return false;
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [refresh],
  );

  return { usage, busy, clear, changeLimit };
}
