import type { WordTimestamp } from "../types";

/** Port of Android's LyricsTiming.kt. */

/** Roughly how long a sung syllable lasts; spreads a short line's fill when its end is unknown. */
const SYLLABLE_MS = 320;
/** The slowest a syllable is drawn out before the rest of a long gap is treated as a pause. */
const MAX_SYLLABLE_MS = 650;
/** The fastest a syllable is filled, so a crowded line still reads as sung, not flashed. */
const MIN_SYLLABLE_MS = 110;
const MAX_BREATH_MS = 450;
const BREATH_SHARE = 0.12;

const LATIN_VOWELS = new Set("aeiouy");
const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;

function isCjk(char: string): boolean {
  const c = char.charCodeAt(0);
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x3040 && c <= 0x309f) ||
    (c >= 0x30a0 && c <= 0x30ff) ||
    (c >= 0xac00 && c <= 0xd7af)
  );
}

const hasCjk = (text: string): boolean => Array.from(text).some(isCjk);

/** Words split on spaces; a line written without spaces in a CJK script is split per character. */
export function lyricTokens(text: string): string[] {
  const words = text.split(/\s+/).filter((w) => w.trim().length > 0);
  if (words.length !== 1 || !hasCjk(words[0]!)) return words;
  const result: string[] = [];
  for (const piece of words[0]!) {
    // Punctuation rides with the character before it rather than taking a beat of its own.
    if (result.length > 0 && !LETTER_OR_DIGIT.test(piece)) result[result.length - 1] += piece;
    else result.push(piece);
  }
  return result;
}

/** A rough syllable count: vowel groups for alphabetic scripts, one per character for CJK. */
export function syllableWeight(token: string): number {
  const chars = Array.from(token);
  if (chars.some(isCjk)) return Math.max(1, chars.filter(isCjk).length);
  const plain = Array.from(token.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, ""));
  const letters = plain.filter((c) => LETTER.test(c)).length;
  if (letters === 0) return 1;
  // Abjads and scripts without these vowels: about one syllable per two or three letters.
  if (!plain.some((c) => LATIN_VOWELS.has(c))) return Math.max(1, Math.trunc((letters + 2) / 3));
  let groups = 0;
  let inVowel = false;
  for (const c of plain) {
    const vowel = LATIN_VOWELS.has(c);
    if (vowel && !inVowel) groups++;
    inVowel = vowel;
  }
  return Math.max(1, groups);
}

/**
 * Word timings for a line that only has a start time: the line's words are spread across the time
 * until `nextLineMs`, weighted by their syllables, leaving a short breath before the next line. A
 * long gap after the line is not stretched into: syllables cap at a natural length and the rest
 * becomes a pause. Scripts written without spaces (Chinese, Japanese) are filled per character.
 */
export function synthesizeWordTimings(text: string, lineStartMs: number, nextLineMs: number | null): WordTimestamp[] {
  const tokens = lyricTokens(text);
  if (tokens.length === 0) return [];
  const weights = tokens.map(syllableWeight);
  const totalWeight = Math.max(1, weights.reduce((a, b) => a + b, 0));
  const gap = nextLineMs !== null ? nextLineMs - lineStartMs : 0;
  const available = gap > 0 ? gap : totalWeight * SYLLABLE_MS + MAX_BREATH_MS;
  const breath = Math.min(MAX_BREATH_MS, Math.trunc(available * BREATH_SHARE));
  const sung = Math.max(
    Math.min(available - breath, totalWeight * MAX_SYLLABLE_MS),
    Math.min(available, totalWeight * MIN_SYLLABLE_MS),
  );
  let cursor = lineStartMs;
  return tokens.map((token, index) => {
    const duration = Math.trunc((sung * weights[index]!) / totalWeight);
    const start = cursor;
    cursor += duration;
    return { text: token, startTime: start, endTime: cursor };
  });
}

/** [first, last] character indices, inclusive, as Kotlin's IntRange. */
export type CharRange = readonly [number, number];

/**
 * The character range each word covers in `mainText`, found in order, or null when a word cannot
 * be located. Background lines have their outer parentheses stripped from the text, so the first
 * and last words are matched without them.
 */
export function wordCharRanges(mainText: string, words: WordTimestamp[], isBackground: boolean): Array<CharRange | null> {
  let cursor = 0;
  return words.map((word, index) => {
    let raw = word.text.trim();
    if (isBackground) {
      if (index === 0 && raw.startsWith("(")) raw = raw.slice(1);
      if (index === words.length - 1 && raw.endsWith(")")) raw = raw.slice(0, -1);
    }
    if (!raw) return null;
    const start = mainText.indexOf(raw, cursor);
    if (start === -1) return null;
    cursor = start + raw.length;
    return [start, cursor - 1] as const;
  });
}
