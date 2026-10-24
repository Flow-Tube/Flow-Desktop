import { useEffect, useState } from "react";

import { artworkSwatches, SAMPLE_SIDE, type ArtworkSwatches } from "./color/artworkSwatches";

const cache = new Map<string, ArtworkSwatches | null>();

function sample(image: HTMLImageElement): ArtworkSwatches | null {
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
  const [swatches, setSwatches] = useState<ArtworkSwatches | null>(() => (src ? cache.get(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setSwatches(null);
      return;
    }
    if (cache.has(src)) {
      setSwatches(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const result = sample(image);
      cache.set(src, result);
      if (!cancelled) setSwatches(result);
    };
    image.onerror = () => {
      cache.set(src, null);
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
