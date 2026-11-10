import { useEffect, useState } from "react";

import { romanizeLyrics } from "../api/lyrics";
import type { LyricsEntry } from "./types";

const NONE: ReadonlyArray<string | null> = [];

/** A Latin line per lyric line while `enabled`. A failure only leaves the lines without one. */
export function useOnDeviceRomanizations(lines: LyricsEntry[], enabled: boolean): ReadonlyArray<string | null> {
  const [romanized, setRomanized] = useState<ReadonlyArray<string | null>>(NONE);

  useEffect(() => {
    setRomanized(NONE);
    if (!enabled || lines.length === 0 || lines.every((line) => line.romanization?.trim())) return;
    let cancelled = false;
    void romanizeLyrics(lines.map((line) => line.text))
      .then((next) => {
        if (!cancelled) setRomanized(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lines, enabled]);

  return romanized;
}
