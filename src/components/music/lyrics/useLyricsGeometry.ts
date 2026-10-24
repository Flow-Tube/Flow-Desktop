import { useCallback, useMemo, useRef } from "react";

import type { LyricsEntry, WordTimestamp } from "../../../lib/lyrics/types";
import { sanitizeWordTimestamps, splitTrailingHyphenWord } from "../../../lib/lyrics/display/model";
import { synthesizeWordTimings, wordCharRanges } from "../../../lib/lyrics/display/timing";
import { buildKaraokeGeometry, type KaraokeGeometry } from "../../../lib/lyrics/display/karaoke";
import { createCanvasMeasurer, type TextMeasurer } from "../../../lib/lyrics/display/textLayout";
import { mainTextOf, type RowLayout } from "../../../lib/lyrics/display/rowLayout";
import type { LyricsPresentation } from "../../../lib/lyrics/display/presentation";

let sharedMeasurer: TextMeasurer | null = null;

/** One measurer for every lyric row, so its width cache serves them all. */
export const lyricsMeasurer = (): TextMeasurer => (sharedMeasurer ??= createCanvasMeasurer());

/** Each line's word timings: the source's, tidied, or spread over the line when it has none. */
export function useLineWords(lines: LyricsEntry[], nextLineTimes: Array<number | null>): WordTimestamp[][] {
  return useMemo(
    () =>
      lines.map((line, i) =>
        line.words && line.words.length > 0
          ? splitTrailingHyphenWord(sanitizeWordTimestamps(line.words))
          : synthesizeWordTimings(mainTextOf(line), line.time, nextLineTimes[i] ?? null),
      ),
    [lines, nextLineTimes],
  );
}

/** Karaoke geometry for a line, built the first time the line comes near the sung one. */
export function useKaraokeGeometry(
  lines: LyricsEntry[],
  layouts: RowLayout[],
  lineWords: WordTimestamp[][],
  presentation: LyricsPresentation,
): (lineIndex: number, listIndex: number) => KaraokeGeometry | null {
  const cache = useRef(new Map<number, { layout: RowLayout; words: WordTimestamp[]; geometry: KaraokeGeometry }>());
  return useCallback(
    (lineIndex: number, listIndex: number) => {
      const layout = layouts[listIndex];
      const words = lineWords[lineIndex];
      const line = lines[lineIndex];
      if (!layout || layout.kind !== "line" || !words || !line) return null;
      const cached = cache.current.get(lineIndex);
      if (cached && cached.layout === layout && cached.words === words) return cached.geometry;
      const geometry = buildKaraokeGeometry(
        layout.mainText,
        layout.main,
        layout.columnWidth,
        presentation.looks[lineIndex]!.align,
        words,
        wordCharRanges(layout.mainText, words, !!line.isBackground),
        lyricsMeasurer(),
      );
      cache.current.set(lineIndex, { layout, words, geometry });
      return geometry;
    },
    [lines, layouts, lineWords, presentation],
  );
}
