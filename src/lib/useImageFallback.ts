import { useCallback, useState } from "react";

import { proxiedImage } from "./imageProxy";
import { useImageProxyStore } from "../store/useImageProxyStore";

const FAILED_LIMIT = 1024;
// Insertion order is age, so the first entry is the one to drop.
const failedUrls = new Set<string>();

function rememberFailed(url: string) {
  failedUrls.delete(url);
  failedUrls.add(url);
  if (failedUrls.size > FAILED_LIMIT) {
    const oldest = failedUrls.values().next().value;
    if (oldest !== undefined) failedUrls.delete(oldest);
  }
}

/** Forgets every remembered failure, for tests. */
export function clearFailedImages() {
  failedUrls.clear();
}

/**
 * Steps through candidate image URLs as each one fails to load; `src` is null
 * once all have failed. Progress is tied to the candidate list itself, so a new
 * list starts over without a reset effect, which would undo a failure that
 * fires before it runs (an offline load fails within a millisecond).
 *
 * Calling `onLoad` once an image shows remembers the candidates before it as
 * missing for the rest of the session, so a remounted card or another card of
 * the same video skips them. A load is the proof: offline, everything fails and
 * nothing is remembered. The last candidate is always tried.
 */
export function useImageFallback(candidates: ReadonlyArray<string | null | undefined>) {
  const proxyBase = useImageProxyStore((state) => state.base);
  const unique = [
    ...new Set(
      candidates
        .filter((url): url is string => Boolean(url))
        .map((url) => proxiedImage(url, proxyBase)),
    ),
  ];
  const urls = unique.filter((url, index) => index === unique.length - 1 || !failedUrls.has(url));
  const key = urls.join("\n");
  const [failures, setFailures] = useState({ key, count: 0 });
  const count = failures.key === key ? failures.count : 0;
  const src = urls[count] ?? null;

  // Only a failure of the URL still being shown counts, so several images
  // sharing one source move past it once.
  const onError = useCallback(
    () =>
      setFailures((previous) => {
        const current = previous.key === key ? previous.count : 0;
        return key.split("\n")[current] === src ? { key, count: current + 1 } : previous;
      }),
    [key, src],
  );

  const onLoad = useCallback(() => {
    const list = key.split("\n");
    const shown = src === null ? -1 : list.indexOf(src);
    for (const url of list.slice(0, Math.max(0, shown))) rememberFailed(url);
  }, [key, src]);

  /** Whether `src` is the last candidate, which is shown even when it is a placeholder. */
  const isLast = src !== null && count === urls.length - 1;

  return { src, onError, onLoad, isLast };
}
