import type { Rgb } from "../../useDominantColor";

/**
 * CIELAB tone and WCAG contrast, ported from Android's ColorTone.kt (which goes through
 * androidx ColorUtils: sRGB, D65, the same constants as below).
 */

const TONE_STEP = 4;
const LIGHTEST_TONE = 98;
const DARKEST_TONE = 2;
const MID_TONE = 50;

const XYZ_WHITE = [95.047, 100.0, 108.883] as const;

const toLinear = (c: number): number => {
  const v = c / 255;
  return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

function toLab({ r, g, b }: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) * 100;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) * 100;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) * 100;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116);
  const fx = f(x / XYZ_WHITE[0]);
  const fy = f(y / XYZ_WHITE[1]);
  const fz = f(z / XYZ_WHITE[2]);
  return [Math.max(0, 116 * fy - 16), 500 * (fx - fy), 200 * (fy - fz)];
}

function fromLab(l: number, a: number, bb: number): Rgb {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - bb / 200;
  const inv = (t: number) => (t * t * t > 0.008856 ? t * t * t : (116 * t - 16) / 903.3);
  const x = inv(fx) * XYZ_WHITE[0];
  const y = (l > 8 ? fy * fy * fy : l / 903.3) * XYZ_WHITE[1];
  const z = inv(fz) * XYZ_WHITE[2];
  const rl = (x * 3.2406 + y * -1.5372 + z * -0.4986) / 100;
  const gl = (x * -0.9689 + y * 1.8758 + z * 0.0415) / 100;
  const bl = (x * 0.0557 + y * -0.204 + z * 1.057) / 100;
  return { r: fromLinear(rl), g: fromLinear(gl), b: fromLinear(bl) };
}

export const tone = (color: Rgb): number => toLab(color)[0];

export function withTone(color: Rgb, value: number): Rgb {
  const [, a, b] = toLab(color);
  return fromLab(Math.min(100, Math.max(0, value)), a, b);
}

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a) + 0.05;
  const lb = luminance(b) + 0.05;
  return Math.max(la, lb) / Math.min(la, lb);
}

/** Moves `color` away from `surface` in tone until it clears `minRatio`. */
export function ensureContrastOn(color: Rgb, surface: Rgb, minRatio: number): Rgb {
  const lighten = tone(surface) < MID_TONE;
  let candidate = color;
  let value = tone(candidate);
  while (contrastRatio(candidate, surface) < minRatio && (lighten ? value < LIGHTEST_TONE : value > DARKEST_TONE)) {
    value += lighten ? TONE_STEP : -TONE_STEP;
    candidate = withTone(candidate, value);
  }
  return candidate;
}
