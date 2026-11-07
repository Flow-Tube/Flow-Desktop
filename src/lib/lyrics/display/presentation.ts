import type { LyricsEntry, WordTimestamp } from "../types";
import type { Rgb } from "../../useDominantColor";
import { ensureContrastOn, withTone } from "../../color/tone";

/** Port of Android's LyricsPresentation.kt. */

export type LyricsAlign = "left" | "center" | "right";

/** Which side of the panel a singer's lines sit on in a duet. */
export type DuetSide = "start" | "end" | "both";

/**
 * Sides for a duet, one per line: the first singer to appear sits at the start, the second at the
 * end, and any other tag (Apple's "sung together" among them) in the middle. Background vocals
 * follow the line they belong to. Null when fewer than two singers are tagged.
 */
export function duetSides(lines: LyricsEntry[]): Array<DuetSide | null> | null {
  const singers = [
    ...new Set(
      lines
        .filter((line) => !line.isBackground)
        .map((line) => line.agent?.trim() ? line.agent : null)
        .filter((agent): agent is string => !!agent && agent !== "bg"),
    ),
  ];
  if (singers.length < 2) return null;
  let previous: DuetSide | null = null;
  return lines.map((line) => {
    if (line.isBackground) return previous;
    const side: DuetSide =
      line.agent === singers[0]
        ? "start"
        : line.agent === singers[1]
          ? "end"
          : !line.agent
            ? previous ?? "start"
            : "both";
    previous = side;
    return side;
  });
}

/** The start time of the next main line after each line, which bounds how long it is sung. */
export function nextMainLineTimes(lines: LyricsEntry[]): Array<number | null> {
  const result: Array<number | null> = new Array(lines.length).fill(null);
  let next: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    result[i] = next;
    if (!lines[i]!.isBackground) next = lines[i]!.time;
  }
  return result;
}

/** The Latin-script line under each lyric when it is wanted: the source's own, else one made on this computer. */
export function lyricsRomanizations(
  lines: LyricsEntry[],
  showRomanization: boolean,
  onDevice: ReadonlyArray<string | null> = [],
): Array<string | null> {
  return lines.map((line, index) => {
    if (!showRomanization) return null;
    return line.romanization?.trim() ? line.romanization : onDevice[index] ?? null;
  });
}

/**
 * The source's word timings carried onto `romanized`, when it splits into as many words as they do.
 * Null otherwise: a Chinese line is timed per character but romanizes into fewer words.
 */
export function romanizedWordTimings(romanized: string, words: WordTimestamp[]): WordTimestamp[] | null {
  const tokens = romanized.split(/\s+/).filter(Boolean);
  if (tokens.length !== words.length) return null;
  return words.map((word, index) => ({ ...word, text: tokens[index]! }));
}

/** The lines with their Latin version in place of the original, where they have one. */
export function romanizedLines(lines: LyricsEntry[], romanizations: ReadonlyArray<string | null>): LyricsEntry[] {
  return lines.map((line, index) => {
    const romanized = romanizations[index];
    if (!romanized) return line;
    return { ...line, text: romanized, words: line.words?.length ? romanizedWordTimings(romanized, line.words) : line.words };
  });
}

/** How one lyric line is dressed: its size, spacing, colour and alignment. */
export interface LyricsLineLook {
  textSize: number;
  lineSpacing: number;
  accent: Rgb;
  align: LyricsAlign;
}

export interface LyricsPresentation {
  looks: LyricsLineLook[];
  nextLineTimes: Array<number | null>;
  romanizations: Array<string | null>;
  showTranslation: boolean;
}

const LINE_SPACING = 1.3;
const MIN_CONTRAST = 4.5;

/** The accent the lyrics read in, lifted until it clears 4.5:1 against what they are drawn over. */
export const readableAccent = (accent: Rgb, backdrop: Rgb | null): Rgb =>
  backdrop ? ensureContrastOn(accent, backdrop, MIN_CONTRAST) : accent;

/**
 * The second singer of a duet takes the backdrop's own hue at a light tone, so the two voices read
 * apart without leaving the artwork's palette.
 */
export function lyricsPresentation(
  lines: LyricsEntry[],
  accent: Rgb,
  backdrop: Rgb | null,
  baseTextSize: number,
  userAlign: LyricsAlign,
  showTranslation: boolean,
  romanizations: Array<string | null>,
): LyricsPresentation {
  const primary = readableAccent(accent, backdrop);
  const secondary = backdrop ? ensureContrastOn(withTone(backdrop, 88), backdrop, MIN_CONTRAST) : primary;
  const sides = duetSides(lines);
  const look = (color: Rgb, align: LyricsAlign): LyricsLineLook => ({
    textSize: baseTextSize,
    lineSpacing: LINE_SPACING,
    accent: color,
    align,
  });
  const looks = lines.map((_, i) => {
    switch (sides?.[i]) {
      case "start":
        return look(primary, "left");
      case "end":
        return look(secondary, "right");
      case "both":
        return look(primary, "center");
      default:
        return look(primary, userAlign);
    }
  });
  return { looks, nextLineTimes: nextMainLineTimes(lines), romanizations, showTranslation };
}
