import { useEffect, useState, type RefObject } from "react";

import { getLocalCover } from "../api/localMedia";
import { useNearViewport } from "../nearViewport";

const known = new Map<string, Promise<string | null>>();

function coverOf(id: string): Promise<string | null> {
  let request = known.get(id);
  if (!request) {
    request = getLocalCover(id).catch(() => null);
    known.set(id, request);
  }
  return request;
}

/** A library file's cover, asked for once it nears the screen, so a long grid reads few files. */
export function useLocalCover(id: string, ref: RefObject<Element | null>): string | null {
  const near = useNearViewport(ref, true);
  const [cover, setCover] = useState<{ id: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    void coverOf(id).then((url) => {
      if (!cancelled) setCover({ id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [id, near]);

  return cover?.id === id ? cover.url : null;
}
