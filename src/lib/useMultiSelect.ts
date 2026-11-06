import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Picking several rows of a list. `availableIds` is what the list holds now: a row that leaves it
 * leaves the selection, and an empty list ends selecting.
 */
export function useMultiSelect(availableIds: string[]) {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const availableKey = availableIds.join("\n");

  useEffect(() => {
    const available = new Set(availableIds);
    setSelectedIds((current) => {
      const kept = [...current].filter((id) => available.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
    if (available.size === 0) setSelecting(false);
    // The joined ids stand in for the array, which is new on every render.
  }, [availableKey]);

  const start = useCallback(() => setSelecting(true), []);

  const stop = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const allSelected = useMemo(
    () => availableIds.length > 0 && availableIds.every((id) => selectedIds.has(id)),
    [availableKey, selectedIds],
  );

  const toggleAll = useCallback((ids: string[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (ids.every((id) => current.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  return { selecting, selectedIds, allSelected, start, stop, toggle, toggleAll };
}
