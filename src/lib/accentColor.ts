import type { Rgb } from './useDominantColor';

/**
 * Artwork colours cover the whole range, near-black and near-grey included, so
 * painting an "on" state with one straight from the extractor often lands
 * invisible against the player's dark chrome — which is exactly what a toggle
 * cannot afford. These helpers keep the hue, the part that ties the control to
 * the track, and lift everything else until the control is legible.
 */

const MIN_CHROMA = 18;
const MIN_SATURATION = 0.5;
const MIN_LIGHTNESS = 0.6;
const MAX_LIGHTNESS = 0.9;
const LIGHTNESS_STEP = 0.02;

/** Contrast target against the chrome behind these controls (AA for icons). */
const MIN_CONTRAST = 4.5;
const CHROME: Rgb = { r: 24, g: 24, b: 27 };

/** Used until artwork resolves, and whenever it yields nothing usable. */
const FALLBACK = 'var(--color-primary)';

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
  else h = ((rn - gn) / delta + 4) / 6;
  return { h, s, l };
}

function channel(p: number, q: number, t: number): number {
  const shifted = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
  if (shifted < 1 / 2) return q;
  if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
  return p;
}

function toRgb(h: number, s: number, l: number): Rgb {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(channel(p, q, h + 1 / 3) * 255),
    g: Math.round(channel(p, q, h) * 255),
    b: Math.round(channel(p, q, h - 1 / 3) * 255),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastAgainstChrome(color: Rgb): number {
  const a = relativeLuminance(color);
  const b = relativeLuminance(CHROME);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Null for artwork with no usable hue, so callers fall back to the theme colour
 * rather than showing a hue this function made up.
 */
function legible(color: Rgb): Rgb | null {
  const chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  if (chroma < MIN_CHROMA) return null;

  const { h, s, l } = toHsl(color);

  const saturation = Math.max(s, MIN_SATURATION);
  // A fixed lightness floor is not enough on its own: blues carry far less
  // luminance than yellows at the same L, so lift until it actually reads.
  let lightness = Math.max(l, MIN_LIGHTNESS);
  let candidate = toRgb(h, saturation, lightness);
  while (lightness < MAX_LIGHTNESS && contrastAgainstChrome(candidate) < MIN_CONTRAST) {
    lightness = Math.min(lightness + LIGHTNESS_STEP, MAX_LIGHTNESS);
    candidate = toRgb(h, saturation, lightness);
  }
  return candidate;
}

/** Foreground colour for a control that is switched on, tinted by the artwork. */
export function accentForeground(color: Rgb | null | undefined): string {
  const readable = color ? legible(color) : null;
  if (!readable) return FALLBACK;
  return `rgb(${readable.r}, ${readable.g}, ${readable.b})`;
}

/** Tonal fill behind that control, so "on" reads without relying on hue alone. */
export function accentSurface(color: Rgb | null | undefined, alpha = 0.22): string {
  const readable = color ? legible(color) : null;
  if (!readable) return `color-mix(in srgb, ${FALLBACK} ${Math.round(alpha * 100)}%, transparent)`;
  return `rgba(${readable.r}, ${readable.g}, ${readable.b}, ${alpha})`;
}
