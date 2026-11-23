import { useEffect, useState } from "react";

import { artworkSwatches, SAMPLE_SIDE, type ArtworkSwatches } from "./color/artworkSwatches";

// Every playlist card on screen adds an entry, so the oldest go once a long session fills it.
const CACHE_LIMIT = 256;
const cache = new Map<string, ArtworkSwatches | null>();

function cached(src: string): ArtworkSwatches | null | undefined {
  if (!cache.has(src)) return undefined;
  const swatches = cache.get(src) ?? null;
  cache.delete(src);
  cache.set(src, swatches);
  return swatches;
}

function remember(src: string, swatches: ArtworkSwatches | null) {
  cache.delete(src);
  cache.set(src, swatches);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** The cover's swatches, or null when the canvas may not read it back. */
export function sampleArtworkSwatches(image: HTMLImageElement): ArtworkSwatches | null {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return null;
  // Palette scales the bitmap to about SAMPLE_SIDE² pixels, keeping its shape.
  const scale = Math.min(1, SAMPLE_SIDE / Math.sqrt(image.naturalWidth * image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    return artworkSwatches(context.getImageData(0, 0, width, height).data);
  } catch {
    // A tainted canvas (no CORS on this image): the player keeps its fallback colours.
    return null;
  }
}

/** The cover's dark base and vivid accent (Android's MediaPalette swatches), cached per URL. */
export function useArtworkSwatches(src: string | null | undefined): ArtworkSwatches | null {
  const [swatches, setSwatches] = useState<ArtworkSwatches | null>(() => (src ? cached(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setSwatches(null);
      return;
    }
    const known = cached(src);
    if (known !== undefined) {
      setSwatches(known);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const result = sampleArtworkSwatches(image);
      remember(src, result);
      if (!cancelled) setSwatches(result);
    };
    image.onerror = () => {
      remember(src, null);
      if (!cancelled) setSwatches(null);
    };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);

  return swatches;
}
