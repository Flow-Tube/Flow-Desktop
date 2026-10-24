import type { WordTimestamp } from "../types";
import type { CharRange } from "./timing";
import type { LaidOutRow, TextBlock, TextMeasurer } from "./textLayout";
import { rowX } from "./textLayout";
import { wordLiftProgress } from "./motion";

/** Port of Android's KaraokeLine.kt geometry and drawing, for a 2D canvas. */

export const HELD_NOTE_MS = 1100;
export const GLOW_STEPS = 8;
export const WORD_LIFT_PX = 3;
export const GLOW_RADIUS_PX = 10;
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
}

export interface KaraokeGeometry {
  rows: KaraokeRow[];
  words: Array<{ startMs: number; endMs: number }>;
  cells: KaraokeCell[];
  font: string;
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
): KaraokeGeometry {
  const font = block.font;
  const rows: KaraokeRow[] = block.rows.map((row, i) => ({
    row,
    x: rowX(row, width, align),
    baseline: i * block.lineHeight + block.ascent,
  }));

  const placed = words.map((_, i) => i).filter((i) => ranges[i]);
  const placedWords = placed.map((i) => ({ startMs: words[i]!.startTime, endMs: words[i]!.endTime }));
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
    let cursor = 0;
    parts.forEach(([rowIndex, first, last], i) => {
      const fraction = (inks[i]![1] - inks[i]![0]) / total;
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
  return { rows, words: placedWords, cells, font };
}

/** Colours and the gradient fronts a line draws with, made once per colour change. */
export interface KaraokePaint {
  sung: string;
  unsung: string;
  forward: CanvasGradient | string;
  backward: CanvasGradient | string;
  /** Shadow colours and blurs for the glow's eight strengths, weakest first. */
  glowColors: string[];
  glowBlurs: number[];
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

    if (frame.glow && cell.glowText !== null && progress > 0 && progress < 1 && cellProgress > 0) {
      const step = Math.min(GLOW_STEPS - 1, Math.max(0, Math.trunc(Math.sin(progress * Math.PI) * GLOW_STEPS)));
      ctx.save();
      ctx.beginPath();
      const left = cell.rtl ? front : cell.inkLeft - GLOW_RADIUS_PX;
      const right = cell.rtl ? cell.inkRight + GLOW_RADIUS_PX : front;
      ctx.rect(left, clipTop, right - left, clipHeight);
      ctx.clip();
      ctx.shadowColor = paint.glowColors[step]!;
      ctx.shadowBlur = paint.glowBlurs[step]!;
      ctx.fillStyle = paint.sung;
      ctx.fillText(cell.glowText, cell.inkLeft, row.baseline - wordLift);
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
