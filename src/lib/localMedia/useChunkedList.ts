import { useCallback, useEffect, useState } from "react";

const CHUNK = 120;
const AHEAD = 40;

/**
 * How many of a long list to render. A library can hold tens of thousands of files, and
 * `content-visibility` skips their layout but not creating their elements. Starts over when the
 * list changes.
 */
export function useChunkedList(listKey: unknown, total: number) {
  const [count, setCount] = useState(CHUNK);

  useEffect(() => {
    setCount(CHUNK);
  }, [listKey]);

  const onLastVisible = useCallback((lastVisible: number) => {
    setCount((current) => (lastVisible + AHEAD >= current ? current + CHUNK : current));
  }, []);

  return { count: Math.min(count, total), onLastVisible };
}
