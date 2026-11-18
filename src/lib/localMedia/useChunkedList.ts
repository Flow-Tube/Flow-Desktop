import { useCallback, useEffect, useRef, useState } from "react";

const CHUNK = 120;
const AHEAD = 40;

// How far each remembered list had been opened, so a page that is left and come back to is
// tall enough again for its scroll position to be restored.
const remembered = new Map<string, { listKey: unknown; count: number }>();

/**
 * How many of a long list to render. A library can hold tens of thousands of files, and
 * `content-visibility` skips their layout but not creating their elements. Starts over when
 * `listKey` changes. With a `memoryKey` the count survives the page being unmounted, for as
 * long as `listKey` stays the same.
 */
export function useChunkedList(listKey: unknown, total: number, memoryKey?: string) {
  const [count, setCount] = useState(() => {
    const saved = memoryKey ? remembered.get(memoryKey) : undefined;
    return saved && saved.listKey === listKey ? saved.count : CHUNK;
  });

  const shownKey = useRef(listKey);
  useEffect(() => {
    if (shownKey.current === listKey) return;
    shownKey.current = listKey;
    setCount(CHUNK);
  }, [listKey]);

  useEffect(() => {
    if (memoryKey) remembered.set(memoryKey, { listKey, count });
  }, [memoryKey, listKey, count]);

  const onLastVisible = useCallback((lastVisible: number) => {
    setCount((current) => (lastVisible + AHEAD >= current ? current + CHUNK : current));
  }, []);

  return { count: Math.min(count, total), onLastVisible };
}
