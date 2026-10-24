/**
 * Colour tone maths, ported from Flow Android's `ui/theme/ColorTone.kt`: tone is
 * CIELAB L* (close to HCT tone), measured and set the way AndroidX `ColorUtils`
 * does, so both apps derive the same player colours from the same cover.
 */
import type { Rgb } from "../useDominantColor";

const TONE_STEP = 4;
const LIGHTEST_TONE = 98;
const DARKEST_TONE = 2;
const MID_TONE = 50;

// D65 white point, as AndroidX ColorUtils.
const WHITE = [95.047, 100.0, 108.883] as const;

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (value: number) => {
  const c = value > 0.0031308 ? 1.055 * value ** (1 / 2.4) - 0.055 : 12.92 * value;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
const labFInverse = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (108 * t - 16) / 841);

export function toLab({ r, g, b }: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) * 100;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) * 100;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) * 100;
  const fx = labF(x / WHITE[0]);
  const fy = labF(y / WHITE[1]);
  const fz = labF(z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function fromLab(l: number, a: number, b: number): Rgb {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = (labFInverse(fx) * WHITE[0]) / 100;
  const y = (l > 8 ? fy ** 3 : l / (24389 / 27)) * (WHITE[1] / 100);
  const z = (labFInverse(fz) * WHITE[2]) / 100;
  return {
    r: fromLinear(x * 3.2406 + y * -1.5372 + z * -0.4986),
    g: fromLinear(x * -0.9689 + y * 1.8758 + z * 0.0415),
    b: fromLinear(x * 0.0557 + y * -0.204 + z * 1.057),
  };
}

export function tone(color: Rgb): number {
  return toLab(color)[0];
}

/** The same hue at [targetTone], its colourfulness held to at most [maxChroma] (CIELAB a*b* distance). */
export function withTone(color: Rgb, targetTone: number, maxChroma = Number.POSITIVE_INFINITY): Rgb {
  const [, a, b] = toLab(color);
  const chroma = Math.hypot(a, b);
  const scale = chroma > maxChroma ? maxChroma / chroma : 1;
  return fromLab(Math.min(100, Math.max(0, targetTone)), a * scale, b * scale);
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a) + 0.05;
  const lb = luminance(b) + 0.05;
  return Math.max(la, lb) / Math.min(la, lb);
}

/** Moves [color] away from [surface] in tone until it clears [minRatio]. */
export function ensureContrastOn(color: Rgb, surface: Rgb, minRatio: number): Rgb {
  const lighten = tone(surface) < MID_TONE;
  let candidate = color;
  let current = tone(candidate);
  while (contrastRatio(candidate, surface) < minRatio && (lighten ? current < LIGHTEST_TONE : current > DARKEST_TONE)) {
    current += lighten ? TONE_STEP : -TONE_STEP;
    candidate = withTone(candidate, current);
  }
  return candidate;
}

/** Straight mix of two colours, `amount` of the way from [from] to [to]. */
export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

export function css({ r, g, b }: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** `#rrggbb` to Rgb; null for anything else (custom themes may hold `color-mix()`). */
export function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
