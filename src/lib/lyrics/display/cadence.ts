import type { KaraokeCell, KaraokeGeometry, KaraokePaint, KaraokeWord } from "./karaoke";
import { GLOW_SHADOW_SHIFT_PX, heldNoteGlowLevel } from "./karaoke";
import type { LyricsAlign } from "./presentation";
import { fastOutSlowIn, linearOutSlowIn } from "./motion";

/** Port of Android's KaraokeMotion.kt and KaraokeCadence.kt, for a 2D canvas. */

/** How high the letters of a Cadence line rise at their crest, as a share of the font size. */
export const CADENCE_PEAK_EM = 0.11;
/** How long a Cadence line takes to let go once the next line starts. */
export const CADENCE_EXIT_MS = 680;

const RIPPLE_CREST = 0.4;
const RIPPLE_SETTLE = 0.4;
const RIPPLE_MIN_MS = 420;
const RIPPLE_MAX_MS = 900;
const SWELL_MIN_MS = 900;
const SWELL_FULL_MS = 1800;
const SWELL_PEAK = 0.035;
const CRESCENDO_STEP = 0.012;
const CRESCENDO_POP = 0.06;
const CRESCENDO_RELEASE_MS = 600;
const EXIT_FILL_MS = 180;

/** When the letter whose ink starts at `from` begins to rise. */
export function rippleTouchMs(wordStartMs: number, wordEndMs: number, from: number, feather: number): number {
  return wordStartMs + Math.max(1, wordEndMs - wordStartMs) * (from - feather);
}

/** After this, every letter of the word up to `to` has settled at the same height. */
export function rippleSettledMs(wordStartMs: number, wordEndMs: number, to: number, feather: number): number {
  return wordStartMs + Math.max(1, wordEndMs - wordStartMs) * (to + feather) + RIPPLE_MAX_MS;
}

/**
 * How high a letter of a Cadence line stands, as a share of the peak lift. It starts rising as the
 * fill's soft edge reaches the letter (`from`, `feather` early) and is at its crest the moment the
 * letter is fully lit (`to`); then it settles a little raised, so sung text sits above what is still
 * to come. The rise outlasts a letter's slot, so neighbouring letters move together like a wave.
 */
export function rippleLift(positionMs: number, wordStartMs: number, wordEndMs: number, from: number, to: number, feather: number): number {
  const touch = rippleTouchMs(wordStartMs, wordEndMs, from, feather);
  const lit = wordStartMs + Math.max(1, wordEndMs - wordStartMs) * (to + feather);
  const wave = Math.min(RIPPLE_MAX_MS, Math.max(RIPPLE_MIN_MS, (lit - touch) / RIPPLE_CREST));
  const progress = (positionMs - touch) / wave;
  if (progress <= 0) return 0;
  if (progress < RIPPLE_CREST) return fastOutSlowIn(progress / RIPPLE_CREST);
  if (progress < 1) return 1 - (1 - RIPPLE_SETTLE) * linearOutSlowIn((progress - RIPPLE_CREST) / (1 - RIPPLE_CREST));
  return RIPPLE_SETTLE;
}

/** A long held note grows a little from its baseline as it is sung, most in the middle of the note. */
export function heldNoteSwell(positionMs: number, startMs: number, endMs: number): number {
  const duration = endMs - startMs;
  if (duration < SWELL_MIN_MS || positionMs <= startMs || positionMs >= endMs) return 1;
  const strength = Math.min(1, Math.max(0, (duration - SWELL_MIN_MS) / (SWELL_FULL_MS - SWELL_MIN_MS)));
  return 1 + SWELL_PEAK * strength * Math.sin((Math.PI * (positionMs - startMs)) / duration);
}

/**
 * A run of syllables sung apart ("so-o-o") climbs: each one is a step bigger than the one before, the
 * last pops, and when the run ends they all spring back down together.
 */
export function crescendoScale(positionMs: number, word: KaraokeWord): number {
  if (word.group < 0 || positionMs < word.startMs) return 1;
  const step = CRESCENDO_STEP * word.group;
  let pop = 0;
  if (word.group === word.groupSize - 1) {
    const progress = Math.min(1, Math.max(0, (positionMs - word.startMs) / Math.max(1, word.endMs - word.startMs)));
    pop = CRESCENDO_POP * linearOutSlowIn(progress);
  }
  if (positionMs <= word.groupEndMs) return 1 + step + pop;
  const release = Math.min(1, Math.max(0, (positionMs - word.groupEndMs) / CRESCENDO_RELEASE_MS));
  const spring = Math.exp(-3.5 * release) * Math.cos(5 * Math.PI * release) * (1 - release);
  return 1 + (step + pop) * spring;
}

/**
 * Which share of a row's extra width moves it the other way when words grow, so the row stays where
 * its alignment holds it: none for a row held at its left edge, half for a centred one, all for one
 * held at its right edge.
 */
export function reflowAnchor(align: LyricsAlign): number {
  if (align === "center") return 0.5;
  return align === "right" ? 1 : 0;
}

/** How far an ending line's fill is pushed on `exit` of its letting go: it completes in the first 180 ms. */
export function exitFill(exit: number): number {
  return Math.min(1, Math.max(0, (exit * CADENCE_EXIT_MS) / EXIT_FILL_MS));
}

/** Where a Cadence frame is: the playhead it reads and how far the line's own motion has come. */
export interface CadenceFrame {
  /** The song position the line is drawn at: the live one while sung, the last one while it lets go. */
  position: number | null;
  /** 0 to 1 while the line lets go after the next one starts, -1 otherwise. */
  exit: number;
  lineLift: number;
  peakPx: number;
  featherPx: number;
  anchor: number;
  glow: boolean;
  overscan: number;
  height: number;
}

/**
 * One frame of a Cadence line: the fill front as Classic draws it, letters that rise as the front
 * reaches them, held notes and hyphen runs that grow from their baseline while the rest of the row
 * moves over, and, once the next line starts, a fill that completes. The sung colour then fades with
 * the row itself. Nothing is allocated.
 */
export function drawCadence(ctx: CanvasRenderingContext2D, geometry: KaraokeGeometry, paint: KaraokePaint, frame: CadenceFrame): void {
  reflowRows(geometry, frame);
  const { cells } = geometry;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    const progress = fillProgress(geometry, cell, frame);
    const cellProgress = Math.min(1, Math.max(0, (progress - cell.startFraction) / cell.widthFraction));
    if (frame.glow && frame.exit < 0 && cell.glowText !== null) drawGlow(ctx, geometry, index, paint, frame, progress);
    drawCell(ctx, geometry, index, paint, frame, cellProgress);
  }
}

function fillProgress(geometry: KaraokeGeometry, cell: KaraokeCell, frame: CadenceFrame): number {
  const position = frame.position;
  if (position === null) return 0;
  const word = cell.word >= 0 ? geometry.words[cell.word] : undefined;
  let progress: number;
  if (!word) progress = position >= (geometry.words[cell.wordBefore]?.endMs ?? Number.POSITIVE_INFINITY) ? 1 : 0;
  else if (position < word.startMs) progress = 0;
  else if (position >= word.endMs) progress = 1;
  else progress = (position - word.startMs) / Math.max(1, word.endMs - word.startMs);
  return frame.exit >= 0 ? Math.max(progress, exitFill(frame.exit)) : progress;
}

/**
 * Sizes every word for this frame and moves each row's cells so grown words push their neighbours
 * aside instead of overlapping them, keeping the row where its alignment holds it.
 */
function reflowRows(geometry: KaraokeGeometry, frame: CadenceFrame): void {
  const { words, cells, rowOrder, wordScale, cellScale, cellDx } = geometry;
  const settle = frame.exit >= 0 ? 1 - frame.exit : 1;
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const grown =
      frame.position === null ? 1 : heldNoteSwell(frame.position, word.startMs, word.endMs) * crescendoScale(frame.position, word);
    wordScale[index] = 1 + (grown - 1) * settle;
  }
  for (let row = 0; row < rowOrder.length; row++) {
    const order = rowOrder[row]!;
    let pushed = 0;
    for (let k = 0; k < order.length; k++) {
      const index = order[k]!;
      const cell = cells[index]!;
      const scale = cell.word >= 0 ? wordScale[cell.word]! : 1;
      const extra = (cell.inkRight - cell.inkLeft) * (scale - 1);
      cellScale[index] = scale;
      cellDx[index] = pushed + extra / 2;
      pushed += extra;
    }
    const shift = -pushed * frame.anchor;
    for (let k = 0; k < order.length; k++) cellDx[order[k]!]! += shift;
  }
}

/** How high a span of a word stands, from its share `from` to `to` of the word, in px. */
function liftPx(word: KaraokeWord | undefined, from: number, to: number, frame: CadenceFrame): number {
  if (!word || frame.position === null || frame.lineLift === 0) return 0;
  const feather = frame.featherPx / 2 / word.inkWidth;
  return rippleLift(frame.position, word.startMs, word.endMs, from, to, feather) * frame.peakPx * frame.lineLift;
}

/** Moves the canvas to a cell's place this frame, grown about its own baseline. */
function placeCell(ctx: CanvasRenderingContext2D, geometry: KaraokeGeometry, index: number, baseline: number): void {
  const cell = geometry.cells[index]!;
  const grow = geometry.cellScale[index]!;
  ctx.translate(geometry.cellDx[index]!, 0);
  if (grow !== 1) {
    const centre = (cell.inkLeft + cell.inkRight) / 2;
    ctx.translate(centre, baseline);
    ctx.scale(grow, grow);
    ctx.translate(-centre, -baseline);
  }
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  geometry: KaraokeGeometry,
  index: number,
  paint: KaraokePaint,
  frame: CadenceFrame,
  cellProgress: number,
): void {
  const cell = geometry.cells[index]!;
  const row = geometry.rows[cell.row]!;
  const word = cell.word >= 0 ? geometry.words[cell.word] : undefined;
  const start = cell.startFraction;
  const end = cell.startFraction + cell.widthFraction;
  const front = cell.rtl
    ? cell.inkRight - (cell.inkRight - cell.inkLeft) * cellProgress
    : cell.inkLeft + (cell.inkRight - cell.inkLeft) * cellProgress;
  const filling = cellProgress > 0 && cellProgress < 1;
  ctx.save();
  ctx.direction = row.row.rtl ? "rtl" : "ltr";
  placeCell(ctx, geometry, index, row.baseline);
  ctx.fillStyle = filling ? (cell.rtl ? paint.backward : paint.forward) : cellProgress >= 1 ? paint.sung : paint.unsung;
  // The gradient is fixed around x = 0; moving the origin to the front slides it into place.
  const shift = filling ? front : 0;
  if (filling) ctx.translate(front, 0);
  const letters = cell.letters;
  const feather = word ? frame.featherPx / 2 / word.inkWidth : 0;
  const perLetter =
    letters !== null &&
    word !== undefined &&
    frame.position !== null &&
    frame.lineLift !== 0 &&
    frame.position >= rippleTouchMs(word.startMs, word.endMs, start, feather) &&
    frame.position < rippleSettledMs(word.startMs, word.endMs, end, feather);
  if (perLetter) {
    for (let k = 0; k < letters.length; k++) {
      const letter = letters[k]!;
      ctx.fillText(letter.text, letter.x - shift, row.baseline - liftPx(word, letter.from, letter.to, frame));
    }
  } else {
    ctx.beginPath();
    ctx.rect(cell.clipLeft - shift, -frame.overscan, cell.clipRight - cell.clipLeft, frame.height + frame.overscan * 2);
    ctx.clip();
    ctx.fillText(row.row.text, row.x - shift, row.baseline - liftPx(word, start, end, frame));
  }
  ctx.restore();
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  geometry: KaraokeGeometry,
  index: number,
  paint: KaraokePaint,
  frame: CadenceFrame,
  progress: number,
): void {
  const level = heldNoteGlowLevel(progress);
  if (level < 0) return;
  const cell = geometry.cells[index]!;
  const row = geometry.rows[cell.row]!;
  const word = cell.word >= 0 ? geometry.words[cell.word] : undefined;
  const lift = liftPx(word, cell.startFraction, cell.startFraction + cell.widthFraction, frame);
  ctx.save();
  ctx.direction = row.row.rtl ? "rtl" : "ltr";
  placeCell(ctx, geometry, index, row.baseline);
  // Shadows ignore the canvas transform, so they are given in device pixels, grown words included.
  const scale = typeof ctx.getTransform === "function" ? ctx.getTransform().a : 1;
  ctx.shadowColor = paint.glowColors[level]!;
  ctx.shadowBlur = paint.glowBlur * scale;
  ctx.shadowOffsetX = GLOW_SHADOW_SHIFT_PX * scale;
  ctx.fillStyle = paint.sung;
  ctx.fillText(cell.glowText!, cell.inkLeft - GLOW_SHADOW_SHIFT_PX, row.baseline - lift);
  ctx.restore();
}
