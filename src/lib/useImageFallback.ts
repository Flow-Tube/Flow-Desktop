import { useCallback, useState } from "react";

/**
 * Steps through candidate image URLs as each one fails to load; `src` is null
 * once all have failed. Progress is tied to the candidate list itself, so a new
 * list starts over without a reset effect, which would undo a failure that
 * fires before it runs (an offline load fails within a millisecond).
 */
export function useImageFallback(candidates: ReadonlyArray<string | null | undefined>) {
  const urls = [...new Set(candidates.filter((url): url is string => Boolean(url)))];
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

  return { src, onError };
}
