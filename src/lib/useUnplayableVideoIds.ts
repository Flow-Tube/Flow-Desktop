import { useEffect, useState } from "react";
import { getUnplayableVideoIds } from "./api/youtube";

const NONE: ReadonlySet<string> = new Set();

/**
 * Videos that were refused for good when opened, read once per mount while `enabled`. Until the
 * list arrives, or when it cannot be read, nothing is hidden: the feed shows everything rather
 * than wait on an optional filter.
 */
export function useUnplayableVideoIds(enabled: boolean): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);

  useEffect(() => {
    if (!enabled) {
      setIds(NONE);
      return;
    }
    let cancelled = false;
    getUnplayableVideoIds()
      .then((list) => {
        if (!cancelled) setIds(new Set(list));
      })
      .catch((error: unknown) => console.error("Could not read unplayable videos", error));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return ids;
}
