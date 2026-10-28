import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { seenVideoIdsAmong } from "./api/recommendation";

interface Answers {
  key: string;
  asked: ReadonlySet<string>;
  seen: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * With "Hide videos you've already seen" on, whether each of `ids` may be shown on the page
 * named by `pageKey`. Each id is asked about once per page, so a card seen here does not vanish
 * when more load; an id still being asked about waits hidden, and `waiting` holds until the
 * page's first answer. When the answer cannot be read, nothing is hidden.
 */
export function useUnseenFilter(pageKey: string, ids: string[], enabled: boolean) {
  const [answers, setAnswers] = useState<Answers>({ key: pageKey, asked: EMPTY, seen: EMPTY });
  const askedRef = useRef<{ key: string; ids: Set<string> }>({ key: pageKey, ids: new Set() });
  const idsKey = ids.join(",");

  useEffect(() => {
    if (!enabled) return;
    if (askedRef.current.key !== pageKey) askedRef.current = { key: pageKey, ids: new Set() };
    const fresh = ids.filter((id) => !askedRef.current.ids.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) askedRef.current.ids.add(id);
    const settle = (seenIds: string[]) =>
      setAnswers((current) => {
        const base = current.key === pageKey ? current : { key: pageKey, asked: EMPTY, seen: EMPTY };
        return {
          key: pageKey,
          asked: new Set([...base.asked, ...fresh]),
          seen: new Set([...base.seen, ...seenIds]),
        };
      });
    seenVideoIdsAmong(fresh)
      .then(settle)
      .catch((error: unknown) => {
        console.error("Could not read seen videos", error);
        settle([]);
      });
    // `idsKey` stands for `ids`, so a new array with the same ids asks nothing again.
  }, [pageKey, idsKey, enabled]);

  const isShown = useCallback(
    (id: string) => {
      if (!enabled) return true;
      if (answers.key !== pageKey) return false;
      return answers.asked.has(id) && !answers.seen.has(id);
    },
    [answers, enabled, pageKey],
  );
  const waiting = enabled && ids.length > 0 && (answers.key !== pageKey || answers.asked.size === 0);
  return useMemo(() => ({ isShown, waiting }), [isShown, waiting]);
}
