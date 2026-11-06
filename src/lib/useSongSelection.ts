import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SongItem } from '../types/music';

const songId = (song: SongItem) => song.videoId ?? song.id;

/** The ids a shift-click selects: from the last song picked through this one, in shown order. */
export function selectionRange(shownIds: string[], anchorId: string | null, id: string): string[] {
  const end = shownIds.indexOf(id);
  const start = anchorId === null ? -1 : shownIds.indexOf(anchorId);
  if (start < 0 || end < 0) return [id];
  return shownIds.slice(Math.min(start, end), Math.max(start, end) + 1);
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/**
 * Picking several songs of a page. `ordered` is every song in the page's order and `shown` what the
 * search leaves on screen: Select all works on what you can see, and a pick survives a new search.
 */
export function useSongSelection(ordered: SongItem[], shown: SongItem[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const anchorRef = useRef<string | null>(null);
  const selecting = selectedIds !== null;
  const shownIds = useMemo(() => shown.map(songId), [shown]);

  const start = useCallback(() => {
    anchorRef.current = null;
    setSelectedIds(new Set());
  }, []);
  const stop = useCallback(() => setSelectedIds(null), []);

  const toggle = useCallback(
    (song: SongItem, extendRange = false) => {
      const id = songId(song);
      setSelectedIds((current) => {
        const next = new Set(current ?? []);
        if (extendRange) selectionRange(shownIds, anchorRef.current, id).forEach((rangeId) => next.add(rangeId));
        else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
    },
    [shownIds],
  );

  const allSelected = shownIds.length > 0 && shownIds.every((id) => selectedIds?.has(id));

  const toggleAll = useCallback(() => {
    setSelectedIds((current) => {
      const next = new Set(current ?? []);
      const everyShown = shownIds.length > 0 && shownIds.every((id) => next.has(id));
      shownIds.forEach((id) => (everyShown ? next.delete(id) : next.add(id)));
      return next;
    });
  }, [shownIds]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        stop();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        toggleAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, stop, toggleAll]);

  const selectedSongs = useMemo(
    () => (selectedIds ? ordered.filter((song) => selectedIds.has(songId(song))) : []),
    [ordered, selectedIds],
  );

  return { selecting, selectedIds, selectedSongs, allSelected, start, stop, toggle, toggleAll };
}
