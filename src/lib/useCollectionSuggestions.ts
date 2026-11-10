import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mergeSuggestions, suggestionSeeds } from './musicCollectionSuggestions';
import { relatedSongs } from './musicRecall';
import { useMusicHiddenFilter } from '../store/useMusicActionsStore';
import type { SongItem } from '../types/music';

/**
 * Songs to add under your own list, from what YouTube Music relates to a few of its tracks. Fetched
 * once, when the end of the list comes into view; refresh moves on to other tracks of the list.
 */
export function useCollectionSuggestions(listId: string | null, songs: SongItem[]) {
  const [suggestions, setSuggestions] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(false);
  const roundRef = useRef(0);
  const requestRef = useRef(0);
  const requestedRef = useRef(false);
  const isHidden = useMusicHiddenFilter();

  const songIds = useMemo(() => songs.map((song) => song.videoId ?? song.id), [songs]);
  const songIdsRef = useRef(songIds);
  songIdsRef.current = songIds;

  const fetchRound = useCallback(async () => {
    const seeds = suggestionSeeds(songIdsRef.current, roundRef.current);
    const request = ++requestRef.current;
    if (seeds.length === 0) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const related = await Promise.all(seeds.map(relatedSongs));
    if (requestRef.current !== request) return;
    setSuggestions(mergeSuggestions(related, new Set(songIdsRef.current)));
    setLoading(false);
  }, []);

  useEffect(() => {
    roundRef.current = 0;
    requestedRef.current = false;
    requestRef.current += 1;
    setSuggestions([]);
    setLoading(false);
  }, [listId]);

  const requestOnce = useCallback(() => {
    if (requestedRef.current || !listId) return;
    requestedRef.current = true;
    void fetchRound();
  }, [fetchRound, listId]);

  const refresh = useCallback(() => {
    roundRef.current += 1;
    void fetchRound();
  }, [fetchRound]);

  const visible = useMemo(() => {
    const inList = new Set(songIds);
    return suggestions.filter((song) => !inList.has(song.videoId ?? song.id) && !isHidden(song));
  }, [isHidden, songIds, suggestions]);

  return { suggestions: visible, loading, requestOnce, refresh };
}
