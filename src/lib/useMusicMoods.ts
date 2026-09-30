import { useCallback, useEffect, useState } from 'react';

import { getMusicMoodGroups } from './api/music';
import { getBackendErrorMessage } from './api/errors';
import type { MoodAndGenreGroup } from '../types/music';

export function useMusicMoods() {
  const [groups, setGroups] = useState<MoodAndGenreGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups(await getMusicMoodGroups());
    } catch (reason) {
      setError(getBackendErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { groups, loading, error, reload: load };
}
