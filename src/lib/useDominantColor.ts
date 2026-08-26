import { useEffect, useState } from "react";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const cache = new Map<string, Rgb | null>();
const BUCKET_SIZE = 24;

type ColorBucket = {
  r: number;
  g: number;
  b: number;
  weight: number;
  score: number;
};

export function extractDominantColorFromImage(img: HTMLImageElement): Rgb | null {
  /*
    `complete` is not "loaded": it is also true for a broken image, because the
    fetch finished — it just finished by failing. Drawing one throws
    InvalidStateError ("no image data"), so the decoded size is the only honest
    readiness test. Callers reach this from mouseenter, where a throw per card
    under a sweeping cursor turns one dead thumbnail into an error storm.
  */
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return null;

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, size, size);
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // Tainted canvas (no CORS), or the image broke between the check and the
    // draw — the caller falls back to the neutral wash either way.
    return null;
  }

  const buckets = new Map<string, ColorBucket>();
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let acount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 200) continue;
    ar += r;
    ag += g;
    ab += b;
    acount++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luma < 0.08 || luma > 0.94 || sat < 0.08) continue;

    const key = [
      Math.round(r / BUCKET_SIZE),
      Math.round(g / BUCKET_SIZE),
      Math.round(b / BUCKET_SIZE),
    ].join(':');
    const weight = 0.35 + sat;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0, score: 0 };
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    bucket.weight += weight;
    bucket.score += 1 + sat * 1.5;
    buckets.set(key, bucket);
  }

  let bestBucket: ColorBucket | null = null;
  for (const bucket of buckets.values()) {
    if (!bestBucket || bucket.score > bestBucket.score) {
      bestBucket = bucket;
    }
  }

  if (bestBucket && bestBucket.weight > 0) {
    return {
      r: Math.round(bestBucket.r / bestBucket.weight),
      g: Math.round(bestBucket.g / bestBucket.weight),
      b: Math.round(bestBucket.b / bestBucket.weight),
    };
  }

  if (acount > 0) return { r: Math.round(ar / acount), g: Math.round(ag / acount), b: Math.round(ab / acount) };
  return null;
}

/** Extracts a vibrant dominant color from artwork for immersive theming. */
export function useDominantColor(src: string | null | undefined): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(() => (src ? cache.get(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    if (cache.has(src)) {
      setColor(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = extractDominantColorFromImage(img);
      cache.set(src, c);
      if (!cancelled) setColor(c);
    };
    img.onerror = () => {
      cache.set(src, null);
      if (!cancelled) setColor(null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return color;
}
