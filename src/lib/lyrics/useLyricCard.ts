import { useCallback, useEffect, useRef, useState } from "react";

import { useUiStore } from "../../store/useUiStore";
import { savePngImage } from "../api/files";
import { blobToBase64, loadCanvasImage } from "../canvasImage";
import { safeFileName } from "../fileName";
import { getString } from "../i18n/index";
import { sampleArtworkSwatches } from "../useArtworkSwatches";
import { copyPng, copyText } from "../clipboard";
import { lyricsCopyText, renderLyricCardBlob, type LyricCardData, type LyricCardLook } from "./lyricCardRenderer";
import { cardColors, readAppCardColors, type CardColors } from "./palette";
import { readLyricsCover } from "./useLyricsCover";

interface Artwork {
  art: HTMLImageElement | null;
  colors: CardColors;
}

/** The cover, loaded once so the canvas may read it, and the looks it and the app theme give the card. */
export function useLyricCardArtwork(coverUrl: string | null | undefined): Artwork | null {
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  useEffect(() => {
    let cancelled = false;
    setArtwork(null);
    void loadCanvasImage(coverUrl).then((art) => {
      if (cancelled) return;
      setArtwork({ art, colors: cardColors(art && readLyricsCover(art), art && sampleArtworkSwatches(art), readAppCardColors()) });
    });
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);
  return artwork;
}

/**
 * Draws the card whenever its lines or look change. The preview shows this same PNG, so what is
 * copied or saved is exactly what was on screen.
 */
export function useLyricCardImage(data: LyricCardData | null, look: Omit<LyricCardLook, "fontFamily"> | null, art: HTMLImageElement | null) {
  const showToast = useUiStore((state) => state.showToast);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const pending = useRef<Promise<Blob | null> | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!data || !look) return;
    let cancelled = false;
    setRendering(true);
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const render = renderLyricCardBlob(data, { ...look, fontFamily }, art);
    pending.current = render;
    void render.then((blob) => {
      if (cancelled) return;
      setRendering(false);
      if (!blob) return;
      // The last card stays up until the new one is ready, so switching looks never flashes empty.
      const previous = urlRef.current;
      urlRef.current = URL.createObjectURL(blob);
      setPreviewUrl(urlRef.current);
      if (previous) URL.revokeObjectURL(previous);
    });
    return () => {
      cancelled = true;
    };
  }, [data, look, art]);

  // WebKit only lets the clipboard write start inside the click, so the promise goes in unresolved.
  const copy = useCallback(() => {
    const render = pending.current;
    if (!render) return;
    const image = render.then((blob) => {
      if (!blob) throw new Error("No lyric card to copy");
      return blob;
    });
    void copyPng(image).then((copied) =>
      showToast({ variant: copied ? "success" : "error", message: getString(copied ? "lyrics_share_copied" : "lyrics_share_copy_failed") }),
    );
  }, [showToast]);

  const save = useCallback(async () => {
    const blob = await pending.current;
    if (!blob || !data) return;
    const name = safeFileName([data.artist, data.title].filter(Boolean).join(" - "), "flow-lyrics");
    try {
      if (await savePngImage(await blobToBase64(blob), `${name}.png`, getString("lyrics_share_save_image"))) {
        showToast({ variant: "success", message: getString("lyrics_share_saved") });
      }
    } catch (error) {
      console.warn("Failed to save the lyric card", error);
      showToast({ variant: "error", message: getString("lyrics_share_save_failed") });
    }
  }, [data, showToast]);

  const copyLines = useCallback(() => {
    if (!data) return;
    void copyText(lyricsCopyText(data.lines, data.title, data.artist)).then((copied) =>
      showToast({ variant: copied ? "success" : "error", message: getString(copied ? "lyrics_share_text_copied" : "lyrics_share_copy_failed") }),
    );
  }, [data, showToast]);

  return { previewUrl, rendering, copy, copyLines, save };
}
