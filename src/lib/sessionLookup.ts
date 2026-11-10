import { useEffect, useState } from "react";

/**
 * A value per id, shared by every card and held for the session.
 *
 * Each card used to resolve its own from an effect: a feed of several hundred
 * cards meant that many IPC round trips, and the whole set fired again on every
 * remount. The backend keeps the real cache, so holding answers here cannot serve
 * anything staler than it already allows.
 */
export interface SessionLookup<T> {
  /** `undefined` is a miss; `null` is a remembered "this id has no value". */
  peek: (id: string) => T | null | undefined;
  load: (id: string) => Promise<T | null>;
}

interface SessionLookupOptions {
  /** What a failure is logged as. */
  label: string;
  /** False when the backend's null can also mean "try again later". */
  rememberAbsent: boolean;
}

export function createSessionLookup<T>(
  request: (id: string) => Promise<T | null | undefined>,
  { label, rememberAbsent }: SessionLookupOptions,
): SessionLookup<T> {
  const cache = new Map<string, T | null>();
  const inFlight = new Map<string, Promise<T | null>>();

  return {
    peek: (id) => cache.get(id),
    load: (id) => {
      const cached = cache.get(id);
      if (cached !== undefined) return Promise.resolve(cached);

      const existing = inFlight.get(id);
      if (existing) return existing;

      const pending = request(id)
        .then((value) => {
          const answer = value ?? null;
          if (answer !== null || rememberAbsent) cache.set(id, answer);
          return answer;
        })
        .catch((error) => {
          console.warn(`Failed to load ${label}`, id, error);
          // Deliberately not cached: a transient failure should not suppress the
          // value for the rest of the session.
          return null;
        })
        .finally(() => {
          inFlight.delete(id);
        });

      inFlight.set(id, pending);
      return pending;
    },
  };
}

/** The value for `key`, or null with no key and until it resolves. */
export function useSessionLookup<T>(lookup: SessionLookup<T>, key: string | null): T | null {
  const [resolved, setResolved] = useState<{ key: string; value: T | null } | null>(null);

  useEffect(() => {
    if (!key || lookup.peek(key) !== undefined) return;

    let active = true;
    void lookup.load(key).then((value) => {
      if (active) setResolved({ key, value });
    });

    return () => {
      active = false;
    };
  }, [key, lookup]);

  if (!key) return null;

  // Read the cache during render so a remounting card, or a second card for the
  // same video, shows the value immediately instead of flashing the listed one
  // for a frame while the effect catches up.
  const cached = lookup.peek(key);
  if (cached !== undefined) return cached;
  return resolved?.key === key ? resolved.value : null;
}
