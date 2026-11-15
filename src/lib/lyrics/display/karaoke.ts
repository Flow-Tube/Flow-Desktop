import type { WordTimestamp } from "../types";
import type { CharRange } from "./timing";
import type { LaidOutRow, TextBlock, TextMeasurer } from "./textLayout";
import { graphemeStarts, rowX } from "./textLayout";
import { wordLiftProgress } from "./motion";

/** Port of Android's KaraokeLine.kt geometry and drawing, for a 2D canvas. */

export const HELD_NOTE_MS = 1100;
/** Glow strengths prepared per colour: steps this small never show. */
export const GLOW_LEVELS = 64;
/** The glow is the shadow of a copy drawn this far to the left, so only the blur lands on the word. */
export const GLOW_SHADOW_SHIFT_PX = 10_000;
export const WORD_LIFT_PX = 3;
export const FEATHER_EM = 0.9;

export interface KaraokeRow {
  row: LaidOutRow;
  /** Where the row's text starts and its baseline, in the line's own coordinates. */
  x: number;
  baseline: number;
}

/**
 * A horizontal slice of one row: a word's part on that row, or punctuation no word covers. The
 * slices of a row meet halfway between their ink and never overlap, so every glyph pixel is drawn
 * exactly once. `glowText` is the word's part alone, for held notes that glow while sung.
 */
export interface KaraokeCell {
  row: number;
  word: number;
  wordBefore: number;
  inkLeft: number;
  inkRight: number;
  rtl: boolean;
  startFraction: number;
  widthFraction: number;
  glowText: string | null;
  clipLeft: number;
  clipRight: number;
  /** The word's letters, for a Cadence line whose letters rise one by one; null keeps it whole. */
  letters: KaraokeLetter[] | null;
}

/**
 * One letter of a cell. `from` and `to` are where its ink starts and ends in the word's reading
 * order, as shares of the word, like the fill front's progress. While letters rise at different
 * heights each is drawn alone at `x`: a cut through the row would leave a kerned neighbour's
 * overhang behind.
 */
export interface KaraokeLetter {
  text: string;
  x: number;
  from: number;
  to: number;
}

/**
 * A timed word. A syllable of a hyphenated run sung apart ("so-o-o") knows its place `group` in the
 * run, the run's `groupSize` and when the run ends; any other word has a `group` of -1.
 */
export interface KaraokeWord {
  startMs: number;
  endMs: number;
  group: number;
  groupSize: number;
  groupEndMs: number;
  inkWidth: number;
}

/**
 * Where every word of a laid-out line sits; built once per layout, read every frame. `rowOrder`
 * lists each row's cells from left to right. `cellDx`, `cellScale` and `wordScale` are scratch
 * space a Cadence frame fills in, so drawing a frame allocates nothing.
 */
export interface KaraokeGeometry {
  rows: KaraokeRow[];
  words: KaraokeWord[];
  cells: KaraokeCell[];
  font: string;
  rowOrder: number[][];
  cellDx: Float64Array;
  cellScale: Float64Array;
  wordScale: Float64Array;
}

function inkOf(row: KaraokeRow, first: number, last: number, font: string, measurer: TextMeasurer): [number, number] {
  const before = measurer.width(row.row.text.slice(0, first), font);
  const through = measurer.width(row.row.text.slice(0, last + 1), font);
  if (row.row.rtl) return [row.x + row.row.width - through, row.x + row.row.width - before];
  return [row.x + before, row.x + through];
}

/**
 * Clip bounds for a row's cells, sorted by their left ink edge, as left and right pairs: each
 * boundary sits halfway between neighbours' ink, and the outer cells reach well past the row.
 */
export function rowCellBounds(inkLefts: number[], inkRights: number[], width: number): number[] {
  const bounds = new Array<number>(inkLefts.length * 2);
  for (let i = 0; i < inkLefts.length; i++) {
    bounds[i * 2] = i === 0 ? -width : (inkRights[i - 1]! + inkLefts[i]!) / 2;
    bounds[i * 2 + 1] = i === inkLefts.length - 1 ? width * 2 : (inkRights[i]! + inkLefts[i + 1]!) / 2;
  }
  return bounds;
}

const isSpace = (char: string | undefined): boolean => !!char && /\s/.test(char);

export function buildKaraokeGeometry(
  text: string,
  block: TextBlock,
  width: number,
  align: "left" | "center" | "right",
  words: WordTimestamp[],
  ranges: Array<CharRange | null>,
  measurer: TextMeasurer,
  splitLetters = false,
): KaraokeGeometry {
  const font = block.font;
  const rows: KaraokeRow[] = block.rows.map((row, i) => ({
    row,
    x: rowX(row, width, align),
    baseline: i * block.lineHeight + block.ascent,
  }));

  const placed = words.map((_, i) => i).filter((i) => ranges[i]);
  const placedWords: KaraokeWord[] = placed.map((i) => ({
    startMs: words[i]!.startTime,
    endMs: words[i]!.endTime,
    group: -1,
    groupSize: 0,
    groupEndMs: 0,
    inkWidth: 1,
  }));
  const cells: KaraokeCell[] = [];

  placed.forEach((original, wordIndex) => {
    const [rangeFirst, rangeLast] = ranges[original]!;
    const held = words[original]!.endTime - words[original]!.startTime >= HELD_NOTE_MS;
    const parts: Array<[number, number, number]> = [];
    rows.forEach((r, rowIndex) => {
      const first = Math.max(rangeFirst, r.row.start);
      const last = Math.min(rangeLast, r.row.end - 1);
      if (first <= last) parts.push([rowIndex, first - r.row.start, last - r.row.start]);
    });
    const inks = parts.map(([rowIndex, first, last]) => inkOf(rows[rowIndex]!, first, last, font, measurer));
    const total = Math.max(1, inks.reduce((sum, [l, r]) => sum + (r - l), 0));
    placedWords[wordIndex]!.inkWidth = total;
    let cursor = 0;
    parts.forEach(([rowIndex, first, last], i) => {
      const fraction = (inks[i]![1] - inks[i]![0]) / total;
      const row = rows[rowIndex]!;
      const letters =
        splitLetters && isLetterSplittable(row.row.text.slice(first, last + 1))
          ? buildLetters(row, first, last, inks[i]![0], inks[i]![1], cursor, fraction, font, measurer)
          : null;
      cells.push({
        row: rowIndex,
        word: wordIndex,
        wordBefore: wordIndex,
        inkLeft: inks[i]![0],
        inkRight: inks[i]![1],
        rtl: rows[rowIndex]!.row.rtl,
        startFraction: cursor,
        widthFraction: fraction,
        glowText: held ? rows[rowIndex]!.row.text.slice(first, last + 1) : null,
        clipLeft: 0,
        clipRight: 0,
        letters,
      });
      cursor += fraction;
    });
  });

  const covered = new Array<boolean>(text.length).fill(false);
  for (const original of placed) {
    const [first, last] = ranges[original]!;
    for (let i = first; i <= last && i < covered.length; i++) covered[i] = true;
  }
  const placedStarts = placed.map((i) => ranges[i]![0]);
  rows.forEach((r, rowIndex) => {
    let i = r.row.start;
    while (i < r.row.end) {
      if (covered[i] || isSpace(text[i])) {
        i++;
        continue;
      }
      let end = i;
      while (end + 1 < r.row.end && !covered[end + 1] && !isSpace(text[end + 1])) end++;
      const [inkLeft, inkRight] = inkOf(r, i - r.row.start, end - r.row.start, font, measurer);
      const before = placedStarts.filter((start) => start <= i).length - 1;
      cells.push({
        row: rowIndex,
        word: -1,
        wordBefore: before,
        inkLeft,
        inkRight,
        rtl: false,
        startFraction: 0,
        widthFraction: 1,
        glowText: null,
        clipLeft: 0,
        clipRight: 0,
        letters: null,
      });
      i = end + 1;
    }
  });

  rows.forEach((_, rowIndex) => {
    const rowCells = cells.filter((cell) => cell.row === rowIndex).sort((a, b) => a.inkLeft - b.inkLeft);
    const bounds = rowCellBounds(
      rowCells.map((cell) => cell.inkLeft),
      rowCells.map((cell) => cell.inkRight),
      width,
    );
    rowCells.forEach((cell, i) => {
      cell.clipLeft = bounds[i * 2]!;
      cell.clipRight = bounds[i * 2 + 1]!;
    });
  });
  markHyphenRuns(
    placed.map((i) => words[i]!.text.trim()),
    placed.map((i) => ranges[i]!),
    placedWords,
  );
  const rowOrder = rows.map((_, rowIndex) =>
    cells
      .map((cell, index) => [cell, index] as const)
      .filter(([cell]) => cell.row === rowIndex)
      .sort(([a], [b]) => a.inkLeft - b.inkLeft)
      .map(([, index]) => index),
  );
  return {
    rows,
    words: placedWords,
    cells,
    font,
    rowOrder,
    cellDx: new Float64Array(cells.length),
    cellScale: new Float64Array(cells.length).fill(1),
    wordScale: new Float64Array(placedWords.length).fill(1),
  };
}

/**
 * Syllables of one hyphenated word sung apart ("so-", "o-", "o" written "so-o-o") follow each other
 * with no space between them; each learns its place in the run so it can grow a step on the last.
 */
export function markHyphenRuns(texts: string[], ranges: CharRange[], words: KaraokeWord[]): void {
  let start = 0;
  while (start < words.length) {
    let end = start;
    while (end + 1 < words.length && texts[end]!.endsWith("-") && ranges[end + 1]![0] === ranges[end]![1] + 1) end++;
    if (end > start) {
      for (let k = start; k <= end; k++) {
        words[k]!.group = k - start;
        words[k]!.groupSize = end - start + 1;
        words[k]!.groupEndMs = words[end]!.endMs;
      }
    }
    start = end + 1;
  }
}

/**
 * Scripts whose letters can be lifted one at a time: each one is a glyph of its own. Joined and
 * shaped scripts (Arabic, the Indic family, Thai and the like) are left out, because a cut between
 * two of their letters would show as a break in the line that joins them.
 */
const LETTER_SCRIPTS =
  /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Hebrew}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Common}\p{Script=Inherited}]*$/u;

/** Whether `word` can rise letter by letter: more than one letter, all in scripts that don't join. */
export function isLetterSplittable(word: string): boolean {
  return LETTER_SCRIPTS.test(word) && letterStarts(word).length > 1;
}

/** Ligatures fonts draw for an "f" and what follows it, which a cut between the two would tear. */
const F_LIGATURE_FOLLOWERS = "fijlt";

/**
 * Where each letter of `word` starts: whole grapheme clusters, so an accent stays with its letter,
 * with an "f" kept together with a letter it may form a ligature with.
 */
export function letterStarts(word: string): number[] {
  const starts: number[] = [];
  for (const index of graphemeStarts(word)) {
    const joinsLigature = starts.length > 0 && word[index - 1] === "f" && F_LIGATURE_FOLLOWERS.includes(word[index]!);
    if (!joinsLigature) starts.push(index);
  }
  return starts;
}

function buildLetters(
  row: KaraokeRow,
  first: number,
  last: number,
  inkLeft: number,
  inkRight: number,
  startFraction: number,
  widthFraction: number,
  font: string,
  measurer: TextMeasurer,
): KaraokeLetter[] {
  const starts = letterStarts(row.row.text.slice(first, last + 1));
  const width = Math.max(1, inkRight - inkLeft);
  const rtl = row.row.rtl;
  const letters = starts.map((start, k) => {
    const from = first + start;
    const to = k === starts.length - 1 ? last : first + starts[k + 1]! - 1;
    const [left, right] = inkOf(row, from, to, font, measurer);
    const near = rtl ? (inkRight - right) / width : (left - inkLeft) / width;
    const far = rtl ? (inkRight - left) / width : (right - inkLeft) / width;
    return {
      text: row.row.text.slice(from, to + 1),
      x: left,
      from: startFraction + widthFraction * near,
      to: startFraction + widthFraction * far,
    };
  });
  return letters.sort((a, b) => a.x - b.x);
}

/** Colours and the gradient fronts a line draws with, made once per colour change. */
export interface KaraokePaint {
  sung: string;
  unsung: string;
  forward: CanvasGradient | string;
  backward: CanvasGradient | string;
  /** Shadow colours for the glow's strengths, weakest first. */
  glowColors: string[];
  /** One blur for every strength: a changing radius is what made the glow visibly step. */
  glowBlur: number;
}

export interface KaraokeFrame {
  /** Offset-adjusted song position in ms, or null when the line is not being sung. */
  position: number | null;
  /** The clock the word lifts read: the position, or the last one while an ended line settles. */
  liftClock: number | null;
  /** The line lift spring, 0 to 1. */
  lift: number;
  glow: boolean;
  /** Extra room drawn into above and below the line, for lifted words and the glow. */
  overscan: number;
  height: number;
}

/**
 * Draws one frame of a line sung word by word. Every layer comes from the same laid-out rows, so
 * the lit and unlit parts always match: a word fills behind a soft gradient front, lifts a few px on
 * a spring as it starts and settles, and long held notes glow while they last. Nothing is allocated.
 */
export function drawKaraoke(ctx: CanvasRenderingContext2D, geometry: KaraokeGeometry, paint: KaraokePaint, frame: KaraokeFrame): void {
  const { rows, words, cells } = geometry;
  const current = frame.position !== null;
  if (!current && frame.lift === 0) {
    ctx.fillStyle = paint.unsung;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      ctx.direction = row.row.rtl ? "rtl" : "ltr";
      ctx.fillText(row.row.text, row.x, row.baseline);
    }
    return;
  }
  const position = frame.position ?? Number.NEGATIVE_INFINITY;
  const clipTop = -frame.overscan;
  const clipHeight = frame.height + frame.overscan * 2;
  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c]!;
    const row = rows[cell.row]!;
    const word = cell.word >= 0 ? words[cell.word] : undefined;
    let progress: number;
    if (!current) progress = 0;
    else if (!word) progress = position >= (words[cell.wordBefore]?.endMs ?? Number.POSITIVE_INFINITY) ? 1 : 0;
    else if (position < word.startMs) progress = 0;
    else if (position >= word.endMs) progress = 1;
    else progress = (position - word.startMs) / Math.max(1, word.endMs - word.startMs);
    const cellProgress = Math.min(1, Math.max(0, (progress - cell.startFraction) / cell.widthFraction));
    const wordLift =
      !word || frame.liftClock === null ? 0 : WORD_LIFT_PX * frame.lift * wordLiftProgress(frame.liftClock - word.startMs);
    const front = cell.rtl
      ? cell.inkRight - (cell.inkRight - cell.inkLeft) * cellProgress
      : cell.inkLeft + (cell.inkRight - cell.inkLeft) * cellProgress;
    ctx.direction = row.row.rtl ? "rtl" : "ltr";

    const glowLevel = frame.glow && cell.glowText !== null ? heldNoteGlowLevel(progress) : -1;
    if (glowLevel >= 0) {
      // Shadows ignore the canvas transform, so they are given in device pixels.
      const scale = typeof ctx.getTransform === "function" ? ctx.getTransform().a : 1;
      ctx.save();
      ctx.shadowColor = paint.glowColors[glowLevel]!;
      ctx.shadowBlur = paint.glowBlur * scale;
      ctx.shadowOffsetX = GLOW_SHADOW_SHIFT_PX * scale;
      ctx.fillStyle = paint.sung;
      ctx.fillText(cell.glowText!, cell.inkLeft - GLOW_SHADOW_SHIFT_PX, row.baseline - wordLift);
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.clipLeft, clipTop, cell.clipRight - cell.clipLeft, clipHeight);
    ctx.clip();
    if (cellProgress >= 1) {
      ctx.fillStyle = paint.sung;
      ctx.fillText(row.row.text, row.x, row.baseline - wordLift);
    } else if (cellProgress <= 0) {
      ctx.fillStyle = paint.unsung;
      ctx.fillText(row.row.text, row.x, row.baseline - wordLift);
    } else {
      // The gradient is fixed around x = 0; moving the origin to the front slides it into place.
      ctx.fillStyle = cell.rtl ? paint.backward : paint.forward;
      ctx.translate(front, 0);
      ctx.fillText(row.row.text, row.x - front, row.baseline - wordLift);
    }
    ctx.restore();
  }
}

/**
 * Which prepared glow strength a held word shows at `progress` through it, or -1 for none. It rises
 * and falls with the word on one smooth curve, in steps too small to see.
 */
export function heldNoteGlowLevel(progress: number): number {
  if (!(progress > 0 && progress < 1)) return -1;
  return Math.min(GLOW_LEVELS - 1, Math.max(0, Math.trunc(Math.sin(progress * Math.PI) * GLOW_LEVELS)));
}
