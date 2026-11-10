import type { Rgb } from "../../useDominantColor";

/** Port of Android's LyricsCoverMesh.kt: a cover reduced to a few colours, darkened for white text. */

export const COVER_CELLS = 8;
export const MESH_SIZE = 64;
const COVER_SATURATION = 1.35;
const MIN_SCRIM = 0.3;
const MAX_SCRIM = 0.9;
const SCRIM_STEP = 0.02;
const MIN_TEXT_CONTRAST = 7;
const CONTRAST_OFFSET = 0.05;

export interface LyricsCover {
  /** MESH_SIZE² RGBA pixels, already saturated. */
  mesh: Uint8ClampedArray;
  /** The brightest darkened cell: the colour lyric text is measured and blended against. */
  backdrop: Rgb;
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = (c: Rgb): number => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);

const contrastWithWhite = (c: Rgb): number => (1 + CONTRAST_OFFSET) / (luminance(c) + CONTRAST_OFFSET);

const mixed = (from: Rgb, to: Rgb, amount: number): Rgb => ({
  r: Math.round(from.r + (to.r - from.r) * amount),
  g: Math.round(from.g + (to.g - from.g) * amount),
  b: Math.round(from.b + (to.b - from.b) * amount),
});

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const darkened = (c: Rgb, scrim: number): Rgb => mixed(c, BLACK, scrim);

const brightestOf = (cells: Rgb[]): Rgb => cells.reduce((best, c) => (luminance(c) > luminance(best) ? c : best));

/** The least darkening at or above the minimum that keeps white text readable on every cell. */
export function coverScrim(cells: Rgb[]): number {
  const brightest = brightestOf(cells);
  let scrim = MIN_SCRIM;
  while (scrim < MAX_SCRIM && contrastWithWhite(darkened(brightest, scrim)) < MIN_TEXT_CONTRAST) scrim += SCRIM_STEP;
  return scrim;
}

const smoothed = (t: number): number => t * t * (3 - 2 * t);

/** Android's ColorMatrix.setToSaturation, on one pixel. */
function saturate(c: Rgb, out: Uint8ClampedArray, at: number): void {
  const inv = 1 - COVER_SATURATION;
  const r = 0.213 * inv;
  const g = 0.715 * inv;
  const b = 0.072 * inv;
  out[at] = (r + COVER_SATURATION) * c.r + g * c.g + b * c.b;
  out[at + 1] = r * c.r + (g + COVER_SATURATION) * c.g + b * c.b;
  out[at + 2] = r * c.r + g * c.g + (b + COVER_SATURATION) * c.b;
  out[at + 3] = 255;
}

/** Enlarges a square of `side` cells to `size` pixels with smoothed steps, which hides the grid plain scaling would show. */
export function coverMesh(cells: Rgb[], side: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const position = (pixel: number) => (pixel / (size - 1)) * (side - 1);
  for (let y = 0; y < size; y++) {
    const down = position(y);
    const top = Math.min(Math.floor(down), side - 2);
    const ty = smoothed(down - top);
    for (let x = 0; x < size; x++) {
      const across = position(x);
      const left = Math.min(Math.floor(across), side - 2);
      const tx = smoothed(across - left);
      const upper = mixed(cells[top * side + left]!, cells[top * side + left + 1]!, tx);
      const lower = mixed(cells[(top + 1) * side + left]!, cells[(top + 1) * side + left + 1]!, tx);
      saturate(mixed(upper, lower, ty), out, (y * size + x) * 4);
    }
  }
  return out;
}

/** `pixels` are the cover scaled to COVER_CELLS² RGBA pixels. */
export function lyricsCover(pixels: Uint8ClampedArray): LyricsCover {
  const raw: Rgb[] = [];
  for (let i = 0; i < COVER_CELLS * COVER_CELLS; i++) raw.push({ r: pixels[i * 4]!, g: pixels[i * 4 + 1]!, b: pixels[i * 4 + 2]! });
  const scrim = coverScrim(raw);
  const cells = raw.map((c) => darkened(c, scrim));
  return { mesh: coverMesh(cells, COVER_CELLS, MESH_SIZE), backdrop: brightestOf(cells) };
}
