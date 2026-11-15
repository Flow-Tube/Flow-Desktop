import { useEffect, useState } from "react";

import { COVER_CELLS, lyricsCover, type LyricsCover } from "./display/coverMesh";
import { IS_LINUX_RUNTIME } from "../platform";
import { usePreference } from "../usePreference";
import { SETTINGS } from "../settings/schema";
import { getString } from "../i18n/index";

export type LyricsBackground = "player" | "colorful" | "moving";

const CACHE_SIZE = 16;
const cache = new Map<string, LyricsCover | null>();

/**
 * What the full-screen lyrics draw on. Linux never moves it: without compositing, WebKitGTK would
 * repaint the whole window on the CPU for every frame of the drift.
 */
export function useLyricsBackground(): LyricsBackground {
  const [stored] = usePreference(SETTINGS.LYRICS_BACKGROUND);
  if (stored === "moving") return IS_LINUX_RUNTIME ? "colorful" : "moving";
  return stored === "colorful" ? "colorful" : "player";
}

/** The choices offered: Linux has no Moving. */
export function lyricsBackgroundOptions(): Array<{ value: LyricsBackground; label: string }> {
  const all: LyricsBackground[] = IS_LINUX_RUNTIME ? ["player", "colorful"] : ["player", "colorful", "moving"];
  return all.map((value) => ({ value, label: getString(`lyrics_background_${value}`) }));
}

/** The cover's colour field, or null when the canvas may not read it back. */
export function readLyricsCover(image: HTMLImageElement): LyricsCover | null {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_CELLS;
  canvas.height = COVER_CELLS;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || image.naturalWidth === 0) return null;
  try {
    context.imageSmoothingQuality = "high";
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const side = Math.min(width, height);
    const sx = (width - side) / 2;
    const sy = (height - side) / 2;
    context.drawImage(image, sx, sy, side, side, 0, 0, COVER_CELLS, COVER_CELLS);
    return lyricsCover(context.getImageData(0, 0, COVER_CELLS, COVER_CELLS).data);
  } catch {
    // A tainted canvas (no CORS on this image): the lyrics keep the player's background.
    return null;
  }
}

/** The cover as a soft colour field. Nothing loads until `enabled`, so a hidden lyrics view does no work. */
export function useLyricsCover(src: string | null | undefined, enabled: boolean): LyricsCover | null {
  const [cover, setCover] = useState<LyricsCover | null>(null);
  useEffect(() => {
    if (!enabled || !src) {
      setCover(null);
      return;
    }
    if (cache.has(src)) {
      setCover(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    const done = (result: LyricsCover | null) => {
      cache.set(src, result);
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
      if (!cancelled) setCover(result);
    };
    image.onload = () => done(readLyricsCover(image));
    image.onerror = () => done(null);
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, enabled]);
  return cover;
}
