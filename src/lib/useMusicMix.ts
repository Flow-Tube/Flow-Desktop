import { useCallback, useEffect, useRef, useState } from 'react';

import { getDailyMixes } from './api/music';
import { getBackendErrorMessage } from './api/errors';
import { dailyMixId, expandDailyMix } from './musicMixes';
import type { DailyMixSeed, SongItem } from '../types/music';

const MIX_LOOKUP = 8;

/**
 * Expands a local Daily Mix. The route's seeds are authoritative; an id-only link
 * (older route) falls back to finding the mix among the brain's current clusters.
 * `routeMix` must be referentially stable (memoize it on the query string).
 */
export function useMusicMix(id: string | undefined, routeMix: DailyMixSeed | null) {
  const [mix, setMix] = useState<DailyMixSeed | null>(null);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const found = routeMix
        ?? (await getDailyMixes(MIX_LOOKUP)).find((candidate) => dailyMixId(candidate) === id)
        ?? null;
      const expanded = found ? await expandDailyMix(found) : [];
      if (requestRef.current !== request) return;
      setMix(found);
      setSongs(expanded);
    } catch (reason) {
      if (requestRef.current === request) setError(getBackendErrorMessage(reason));
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [id, routeMix]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return { mix, songs, loading, error, reload: load };
}
