/**
 * The two colours Flow Android takes from a cover (`MediaPalette.artworkSwatches`):
 * a dark one to sit under the player and a vivid one to draw with. Android gets
 * them from AndroidX Palette; this is a port of the parts that decide them, its
 * median-cut quantizer (16 colours, 5 bits a channel), its default filter, and
 * the scored targets, so a cover yields the same swatches on both apps.
 */
import type { Rgb } from "../useDominantColor";

/** Palette scales a bitmap down to about this many pixels before quantizing. */
export const SAMPLE_SIDE = 112;
const MAX_COLORS = 16;

interface Swatch {
  rgb: Rgb;
  population: number;
  hsl: [number, number, number];
}

function toHsl({ r, g, b }: Rgb): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return [0, 0, l];
  let h: number;
  if (max === rf) h = ((gf - bf) / delta) % 6;
  else if (max === gf) h = (bf - rf) / delta + 2;
  else h = (rf - gf) / delta + 4;
  h = (h * 60) % 360;
  if (h < 0) h += 360;
  return [h, delta / (1 - Math.abs(2 * l - 1)), l];
}

/** Palette's default filter: near-black, near-white, and the skin-tone red "I line". */
function ignored([h, s, l]: [number, number, number]): boolean {
  return l <= 0.05 || l >= 0.95 || (h >= 10 && h <= 37 && s <= 0.82);
}

const quantize = (c: number) => c >> 3;
const expand = (c: number) => (c << 3) | (c >> 2);

interface Box {
  colors: number[]; // packed 5-bit RGB keys
}

function boxRanges(box: Box): [number, number, number] {
  let minR = 31, maxR = 0, minG = 31, maxG = 0, minB = 31, maxB = 0;
  for (const key of box.colors) {
    const r = key >> 10, g = (key >> 5) & 31, b = key & 31;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minG = Math.min(minG, g); maxG = Math.max(maxG, g);
    minB = Math.min(minB, b); maxB = Math.max(maxB, b);
  }
  return [maxR - minR + 1, maxG - minG + 1, maxB - minB + 1];
}

const volume = (box: Box) => boxRanges(box).reduce((a, b) => a * b, 1);

function splitBox(box: Box, histogram: Map<number, number>): [Box, Box] {
  const [rr, gr, br] = boxRanges(box);
  const shift = rr >= gr && rr >= br ? 10 : gr >= br ? 5 : 0;
  const sorted = [...box.colors].sort((a, b) => ((a >> shift) & 31) - ((b >> shift) & 31) || a - b);
  const total = sorted.reduce((sum, key) => sum + histogram.get(key)!, 0);
  let running = 0;
  let cut = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    running += histogram.get(sorted[i]!)!;
    cut = i;
    if (running >= total / 2) break;
  }
  return [{ colors: sorted.slice(0, cut + 1) }, { colors: sorted.slice(cut + 1) }];
}

function average(box: Box, histogram: Map<number, number>): Swatch {
  let r = 0, g = 0, b = 0, population = 0;
  for (const key of box.colors) {
    const count = histogram.get(key)!;
    population += count;
    r += expand(key >> 10) * count;
    g += expand((key >> 5) & 31) * count;
    b += expand(key & 31) * count;
  }
  const rgb = { r: Math.round(r / population), g: Math.round(g / population), b: Math.round(b / population) };
  return { rgb, population, hsl: toHsl(rgb) };
}

/** Quantized swatches of RGBA pixel data, like AndroidX's ColorCutQuantizer. */
export function quantizeSwatches(pixels: Uint8ClampedArray): Swatch[] {
  const histogram = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const key = (quantize(pixels[i]!) << 10) | (quantize(pixels[i + 1]!) << 5) | quantize(pixels[i + 2]!);
    const rgb = { r: expand(key >> 10), g: expand((key >> 5) & 31), b: expand(key & 31) };
    if (ignored(toHsl(rgb))) continue;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const keys = [...histogram.keys()];
  if (keys.length <= MAX_COLORS) {
    return keys.map((key) => average({ colors: [key] }, histogram));
  }
  const boxes: Box[] = [{ colors: keys }];
  while (boxes.length < MAX_COLORS) {
    boxes.sort((a, b) => volume(b) - volume(a));
    const largest = boxes.find((box) => box.colors.length > 1);
    if (!largest) break;
    boxes.splice(boxes.indexOf(largest), 1, ...splitBox(largest, histogram));
  }
  return boxes.map((box) => average(box, histogram)).filter((swatch) => !ignored(swatch.hsl));
}

interface Target {
  light: [number, number, number]; // min, target, max
  sat: [number, number, number];
}

const LIGHT_VIBRANT: Target = { light: [0.55, 0.74, 1], sat: [0.35, 1, 1] };
const VIBRANT: Target = { light: [0.3, 0.5, 0.7], sat: [0.35, 1, 1] };
const DARK_VIBRANT: Target = { light: [0, 0.26, 0.45], sat: [0.35, 1, 1] };
const LIGHT_MUTED: Target = { light: [0.55, 0.74, 1], sat: [0, 0.3, 0.4] };
const MUTED: Target = { light: [0.3, 0.5, 0.7], sat: [0, 0.3, 0.4] };
const DARK_MUTED: Target = { light: [0, 0.26, 0.45], sat: [0, 0.3, 0.4] };
const TARGET_ORDER = [LIGHT_VIBRANT, VIBRANT, DARK_VIBRANT, LIGHT_MUTED, MUTED, DARK_MUTED];

const SATURATION_WEIGHT = 0.24;
const LIGHTNESS_WEIGHT = 0.52;
const POPULATION_WEIGHT = 0.24;

/** Palette's targets, each taking the best unused swatch in its ranges. */
function scoreTargets(swatches: Swatch[]): Map<Target, Swatch> {
  const maxPopulation = Math.max(1, ...swatches.map((s) => s.population));
  const used = new Set<Swatch>();
  const result = new Map<Target, Swatch>();
  for (const target of TARGET_ORDER) {
    let best: Swatch | null = null;
    let bestScore = 0;
    for (const swatch of swatches) {
      const [, s, l] = swatch.hsl;
      if (used.has(swatch)) continue;
      if (s < target.sat[0] || s > target.sat[2] || l < target.light[0] || l > target.light[2]) continue;
      const score =
        SATURATION_WEIGHT * (1 - Math.abs(s - target.sat[1])) +
        LIGHTNESS_WEIGHT * (1 - Math.abs(l - target.light[1])) +
        POPULATION_WEIGHT * (swatch.population / maxPopulation);
      if (best === null || score > bestScore) {
        best = swatch;
        bestScore = score;
      }
    }
    if (best) {
      result.set(target, best);
      used.add(best);
    }
  }
  return result;
}

export interface ArtworkSwatches {
  base: Rgb | null;
  accent: Rgb | null;
}

/** Android's choice: base = dark muted, dark vibrant, dominant; accent = vibrant, light vibrant, light muted. */
export function artworkSwatches(pixels: Uint8ClampedArray): ArtworkSwatches {
  const swatches = quantizeSwatches(pixels);
  if (swatches.length === 0) return { base: null, accent: null };
  const targets = scoreTargets(swatches);
  const dominant = swatches.reduce((a, b) => (b.population > a.population ? b : a));
  const base = targets.get(DARK_MUTED) ?? targets.get(DARK_VIBRANT) ?? dominant;
  const accent = targets.get(VIBRANT) ?? targets.get(LIGHT_VIBRANT) ?? targets.get(LIGHT_MUTED);
  return { base: base.rgb, accent: accent?.rgb ?? null };
}
