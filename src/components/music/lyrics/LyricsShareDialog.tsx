import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Loader2,
  X,
} from "lucide-react";

import type { SongItem } from "../../../types/music";
import type { LyricsEntry } from "../../../lib/lyrics/types";
import { musicAudioEngine } from "../../../lib/audio/musicAudioEngine";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { useLyricsStore } from "../../../store/useLyricsStore";
import { useUiStore } from "../../../store/useUiStore";
import { getString } from "../../../lib/i18n/index";
import { copyPng } from "../../../lib/clipboard";
import { blobToBase64 } from "../../../lib/recap/recapPoster";
import { savePngImage } from "../../../lib/api/files";
import { upgradeMusicImageUrl } from "../../../lib/thumbnails";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import {
  BASE_CARD_HEIGHT,
  BASE_CARD_WIDTH,
  renderLyricCardBlob,
  type CardAlign,
} from "../../../lib/lyrics/lyricCardRenderer";
import {
  extractArtworkPalette,
  type CardStyleOption,
} from "../../../lib/lyrics/palette";
import { FlowLogo } from "../../ui/FlowLogo";
import { LyricsDialog } from "./LyricsDialog";

const MAX_SHARE_LINES = 5;

/** Checks if a line is shareable (non-blank and not a metadata bracket line) */
export function isShareableLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith("[");
}

/** Returns the index in the shareable lines corresponding to playback positionMs */
export function shareLineIndexAt(lines: LyricsEntry[], positionMs: number): number {
  const count = lines.filter((l) => isShareableLine(l.text) && l.time <= positionMs).length;
  return Math.max(0, count - 1);
}

/** Gets the current playback position in milliseconds from music engine or video player */
export function getPlaybackPositionMs(syncOffsetMs = 0): number {
  let seconds = 0;
  try {
    const musicTime = musicAudioEngine.getCurrentTime();
    if (typeof musicTime === "number" && !isNaN(musicTime) && musicTime > 0) {
      seconds = musicTime;
    }
  } catch {
    // Ignore
  }

  if (seconds === 0) {
    try {
      const playerTime = usePlayerStore.getState().currentTime;
      if (typeof playerTime === "number" && !isNaN(playerTime) && playerTime > 0) {
        seconds = playerTime;
      }
    } catch {
      // Ignore
    }
  }

  return Math.max(0, Math.round(seconds * 1000) + syncOffsetMs);
}

/**
 * Automatically selects a cohesive group of lyric lines (up to maxCount)
 * starting at the line where playback is currently playing or paused.
 */
export function autoSelectLyricIndices(
  totalLines: number,
  targetIndex: number,
  maxCount = 4,
): number[] {
  if (totalLines <= 0) return [];
  if (totalLines <= maxCount) {
    return Array.from({ length: totalLines }, (_, i) => i);
  }

  const clampedTarget = Math.max(0, Math.min(totalLines - 1, targetIndex));
  let start = clampedTarget;
  if (start + maxCount > totalLines) {
    start = Math.max(0, totalLines - maxCount);
  }
  const count = Math.min(maxCount, totalLines - start);
  return Array.from({ length: count }, (_, i) => start + i);
}

export function LyricsShareDialog({
  track: propTrack,
  onClose,
}: {
  track: SongItem | null;
  onClose: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const rawEntries = useLyricsStore((s) => s.entries);
  const plain = useLyricsStore((s) => s.plain);
  const syncOffsetMs = useLyricsStore((s) => s.syncOffsetMs);
  const activeMusicTrack = useMusicPlayerStore((s) => s.currentTrack);

  // Fallback to active playing music track if prop track is missing or lacks thumbnail
  const effectiveTrack = propTrack ?? activeMusicTrack;

  // Normalise and proxy thumbnail URL to bypass webview CORS and CSP restrictions
  const rawThumbnail = effectiveTrack?.thumbnail;
  const upgradedThumbnail = useMemo(
    () => upgradeMusicImageUrl(rawThumbnail, 480) ?? rawThumbnail ?? undefined,
    [rawThumbnail],
  );
  const proxiedThumbnail = useProxiedImageUrl(upgradedThumbnail) ?? upgradedThumbnail;

  const [step, setStep] = useState<"select" | "style">("select");
  const [swatchImgFailed, setSwatchImgFailed] = useState(false);

  const allLines = useMemo(() => {
    if (rawEntries.length > 0) {
      return rawEntries
        .map((e) => e.text.trim())
        .filter(isShareableLine);
    }
    if (plain) {
      return plain
        .split("\n")
        .map((l) => l.trim())
        .filter(isShareableLine);
    }
    return [];
  }, [rawEntries, plain]);

  // Initial playback position index computed once on mount
  const initialIndex = useMemo(() => {
    const posMs = getPlaybackPositionMs(syncOffsetMs);
    return shareLineIndexAt(rawEntries, posMs);
  }, [rawEntries, syncOffsetMs]);

  // Automatically select the lyrics part where the player is currently playing or paused
  const [selectedIndices, setSelectedIndices] = useState<number[]>(() => {
    return autoSelectLyricIndices(allLines.length, initialIndex, 4);
  });

  const selectedLines = useMemo(() => {
    return selectedIndices.map((i) => allLines[i]).filter(Boolean) as string[];
  }, [selectedIndices, allLines]);

  const [styles, setStyles] = useState<CardStyleOption[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>("cover");
  const [align, setAlign] = useState<CardAlign>("left");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [cardDimensions, setCardDimensions] = useState<{ width: number; height: number }>({
    width: BASE_CARD_WIDTH,
    height: BASE_CARD_HEIGHT,
  });

  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const cardPreviewRef = useRef<HTMLDivElement | null>(null);

  const activeStyle: CardStyleOption = useMemo(() => {
    return (
      styles.find((s) => s.id === selectedStyleId) ??
      styles[0] ?? {
        id: "surface",
        label: "Surface",
        ground: "#242424",
        hex: "#242424",
        ink: "#f4f4f4",
        isLight: false,
      }
    );
  }, [styles, selectedStyleId]);

  // Auto-scroll to currently playing or paused line on mount
  useEffect(() => {
    if (activeLineRef.current && typeof activeLineRef.current.scrollIntoView === "function") {
      activeLineRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  // Track the exact rendered DOM dimensions of the live card preview
  useEffect(() => {
    if (step !== "style") return undefined;
    const el = cardPreviewRef.current;
    if (!el) return undefined;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        setCardDimensions((prev) => {
          if (prev.width === w && prev.height === h) return prev;
          return { width: w, height: h };
        });
      }
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => measure());
      observer.observe(el);
      return () => {
        observer.disconnect();
      };
    }

    return undefined;
  }, [step, selectedLines, align, activeStyle]);

  // Extract dynamic artwork color styles from the proxied thumbnail URL
  useEffect(() => {
    let cancelled = false;
    extractArtworkPalette(proxiedThumbnail).then((options) => {
      if (cancelled) return;
      setStyles(options);
      if (options.length > 0) {
        // Default to cover if available, otherwise first style
        const hasCover = options.some((o) => o.isCover);
        setSelectedStyleId(hasCover ? "cover" : options[0]?.id ?? "surface");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [proxiedThumbnail]);

  const toggleLine = (index: number) => {
    setSelectedIndices((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index);
      }
      if (prev.length >= MAX_SHARE_LINES) {
        showToast({ variant: "error", message: getString("lyrics_share_max_lines") });
        return prev;
      }
      return [...prev, index].sort((a, b) => a - b);
    });
  };

  const artistName = useMemo(() => {
    return effectiveTrack?.artists?.map((a) => a.name).filter(Boolean).join(", ") || "Unknown Artist";
  }, [effectiveTrack?.artists]);

  // Pre-render high-res card blob when user is on the style step matching exact aspect ratio
  useEffect(() => {
    if (step !== "style" || selectedLines.length === 0) {
      setBlob(null);
      return;
    }

    let cancelled = false;
    setIsRendering(true);

    const theme = activeStyle.isCover ? "cover" : activeStyle.ground;

    void renderLyricCardBlob(
      {
        lines: selectedLines,
        title: effectiveTrack?.title || "Unknown Title",
        artist: artistName,
        coverUrl: proxiedThumbnail || null,
      },
      {
        theme,
        align,
        targetWidth: cardDimensions.width,
        targetHeight: cardDimensions.height,
      },
    ).then((rendered) => {
      if (cancelled) return;
      setIsRendering(false);
      setBlob(rendered);
    });

    return () => {
      cancelled = true;
    };
  }, [step, selectedLines, effectiveTrack, artistName, activeStyle, align, proxiedThumbnail, cardDimensions]);

  const getRenderedBlob = async (): Promise<Blob | null> => {
    if (blob) return blob;
    const theme = activeStyle.isCover ? "cover" : activeStyle.ground;
    return renderLyricCardBlob(
      {
        lines: selectedLines,
        title: effectiveTrack?.title || "Unknown Title",
        artist: artistName,
        coverUrl: proxiedThumbnail || null,
      },
      {
        theme,
        align,
        targetWidth: cardDimensions.width,
        targetHeight: cardDimensions.height,
      },
    );
  };

  const handleCopy = async () => {
    const targetBlob = await getRenderedBlob();
    if (!targetBlob) return;
    const copied = await copyPng(targetBlob);
    showToast({
      variant: copied ? "success" : "error",
      message: getString(copied ? "lyrics_share_copied" : "lyrics_share_copy_failed"),
    });
  };

  const handleSave = async () => {
    const targetBlob = await getRenderedBlob();
    if (!targetBlob) return;
    try {
      const base64 = await blobToBase64(targetBlob);
      const safeTitle = (effectiveTrack?.title || "lyrics").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
      const safeArtist = (effectiveTrack?.artists?.[0]?.name || "flow")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .toLowerCase();
      const filename = `${safeArtist} - ${safeTitle}.png`;
      const saved = await savePngImage(base64, filename, getString("lyrics_share_save_image"));
      if (saved) {
        showToast({ variant: "success", message: getString("lyrics_share_saved") });
      }
    } catch (e) {
      console.warn("Failed to save lyric card", e);
      showToast({ variant: "error", message: getString("lyrics_share_save_failed") });
    }
  };

  // Step 1: Lyrics Selection View (Matches Android LyricsSharePicker)
  if (step === "select") {
    return (
      <LyricsDialog
        onClose={onClose}
        maxWidth="max-w-md"
        customHeader={
          <div className="border-b border-chrome-neutral-800 px-6 pb-4 pt-3">
            <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-chrome-neutral-700" />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-chrome-neutral-100">
                  {getString("lyrics_share_title")}
                </h2>
                <p className="mt-0.5 text-xs text-chrome-neutral-400">
                  {getString("lyrics_share_lines_selected", selectedIndices.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={getString("close")}
                className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        }
        footer={
          <button
            type="button"
            disabled={selectedIndices.length === 0}
            onClick={() => setStep("style")}
            className="w-full rounded-full bg-[var(--color-primary)] py-3.5 text-center text-sm font-bold text-[var(--color-on-primary)] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {getString("next")}
          </button>
        }
      >
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto px-4 py-3">
          {allLines.length === 0 ? (
            <p className="py-8 text-center text-sm text-chrome-neutral-400">
              {getString("music_lyrics_unavailable")}
            </p>
          ) : (
            allLines.map((line, idx) => {
              const isSelected = selectedIndices.includes(idx);
              const enabled = isSelected || selectedIndices.length < MAX_SHARE_LINES;
              const isFirstSelected = selectedIndices[0] === idx;

              return (
                <button
                  key={idx}
                  ref={isFirstSelected ? activeLineRef : null}
                  type="button"
                  disabled={!enabled}
                  onClick={() => toggleLine(idx)}
                  className={`w-full rounded-2xl px-4 py-3 text-start transition-all duration-150 active:scale-[0.99] ${
                    isSelected
                      ? "bg-surface-container-highest text-chrome-neutral-50 shadow-sm"
                      : enabled
                      ? "bg-transparent text-chrome-neutral-200 hover:bg-surface-container-high/60"
                      : "bg-transparent text-chrome-neutral-600 opacity-40 cursor-not-allowed"
                  }`}
                >
                  <span className="line-clamp-2 text-base font-bold tracking-tight leading-snug">
                    {line}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </LyricsDialog>
    );
  }

  // Step 2: Card Customization & Preview View (Matches Android LyricsShareStyler)
  return (
    <LyricsDialog
      onClose={onClose}
      maxWidth="max-w-md"
      customHeader={
        <div className="flex items-center justify-between border-b border-chrome-neutral-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep("select")}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-300 transition-colors hover:bg-surface-container-high hover:text-white"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h2 className="text-base font-bold text-chrome-neutral-100">
                {getString("lyrics_share_title")}
              </h2>
              <p className="text-xs text-chrome-neutral-400">
                {getString("lyrics_share_lines_selected", selectedIndices.length)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={getString("close")}
            className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <X size={18} />
          </button>
        </div>
      }
      footer={
        <div className="flex w-full gap-3">
          <button
            type="button"
            disabled={!blob || isRendering}
            onClick={handleCopy}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] py-3 text-sm font-bold text-[var(--color-on-primary)] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-40"
          >
            {isRendering ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
            {getString("lyrics_share_copy_image")}
          </button>
          <button
            type="button"
            disabled={!blob || isRendering}
            onClick={handleSave}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-surface-container-high py-3 text-sm font-bold text-chrome-neutral-100 transition-colors hover:bg-surface-container-highest active:scale-[0.99] disabled:opacity-40"
          >
            <Download size={16} />
            {getString("lyrics_share_save_image")}
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {/* Live Card Preview (Matches Android LyricsShareCard layout - hugs content with dynamic length) */}
        <div className="w-full max-w-[340px]">
          <div
            ref={cardPreviewRef}
            className="relative flex w-full flex-col overflow-hidden rounded-[28px] px-6 pt-6 pb-7 shadow-2xl transition-colors duration-200"
            style={{
              backgroundColor: activeStyle.ground,
              color: activeStyle.ink,
            }}
          >
            {/* Blurred cover overlay when COLORFUL style is selected */}
            {activeStyle.isCover && proxiedThumbnail && (
              <div
                className="absolute inset-0 bg-cover bg-center brightness-[0.55] filter blur-xl scale-125 pointer-events-none"
                style={{ backgroundImage: `url(${proxiedThumbnail})` }}
              />
            )}
            {activeStyle.isCover && (
              <div className="absolute inset-0 bg-black/40 pointer-events-none" />
            )}

            {/* Content layer above background */}
            <div className="relative z-10 flex flex-col gap-4">
              {/* Card Header: 56x56 artwork + Title & Artist */}
              <div>
                <div className="flex items-center gap-3">
                  {proxiedThumbnail ? (
                    <img
                      src={proxiedThumbnail}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg object-cover shadow-sm"
                    />
                  ) : (
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-white/10 text-lg font-bold">
                      ♪
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold leading-tight">
                      {effectiveTrack?.title || "Unknown Title"}
                    </p>
                    <p
                      className="truncate text-sm opacity-70"
                      style={{ color: activeStyle.ink }}
                    >
                      {artistName}
                    </p>
                  </div>
                </div>
                {/* Horizontal divider with 20% opacity */}
                <div
                  className="mt-3.5 h-px w-full"
                  style={{
                    backgroundColor: activeStyle.ink,
                    opacity: 0.2,
                  }}
                />
              </div>

              {/* Card Lyrics Body - starts right below divider with dynamic line spacing */}
              <div
                className={`flex flex-col ${selectedLines.length <= 3 ? "gap-3" : "gap-2.5"} py-1 ${
                  align === "center"
                    ? "text-center"
                    : align === "right"
                    ? "text-end"
                    : "text-start"
                }`}
              >
                {selectedLines.map((line, i) => (
                  <p
                    key={i}
                    className={`font-bold leading-tight tracking-tight ${
                      selectedLines.length <= 2
                        ? "text-2xl"
                        : selectedLines.length <= 3
                        ? "text-xl"
                        : "text-lg"
                    }`}
                  >
                    {line}
                  </p>
                ))}
              </div>

              {/* Card Footer: Official Flow Logo Badge + Wordmark - generous breathing room above and below */}
              <div className="flex items-center gap-2 pt-6">
                <FlowLogo
                  width={28}
                  shapeColor={activeStyle.ink}
                  glyphColor={activeStyle.ground}
                />
                <span className="text-sm font-bold tracking-tight">Flow</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Color Swatches Row */}
        <div className="flex w-full items-center justify-start gap-3 overflow-x-auto px-4 py-2">
          {styles.map((s) => {
            const isSelected = selectedStyleId === s.id;

            if (s.isCover) {
              return (
                <button
                  key={s.id}
                  type="button"
                  title={s.label}
                  onClick={() => setSelectedStyleId(s.id)}
                  className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full transition-all ${
                    isSelected
                      ? "scale-105 ring-2 ring-white ring-offset-2 ring-offset-surface-container"
                      : "hover:scale-105 opacity-80 hover:opacity-100"
                  }`}
                >
                  {proxiedThumbnail && !swatchImgFailed ? (
                    <img
                      src={proxiedThumbnail}
                      alt=""
                      onError={() => setSwatchImgFailed(true)}
                      className="h-full w-full object-cover brightness-75"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-b from-indigo-900 to-purple-950" />
                  )}
                  {isSelected && (
                    <Check size={18} strokeWidth={3} className="relative z-10 text-white drop-shadow" />
                  )}
                </button>
              );
            }

            return (
              <button
                key={s.id}
                type="button"
                title={s.label}
                onClick={() => setSelectedStyleId(s.id)}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all shadow-sm ${
                  isSelected
                    ? "scale-105 ring-2 ring-white ring-offset-2 ring-offset-surface-container"
                    : "hover:scale-105 opacity-80 hover:opacity-100"
                }`}
                style={{ backgroundColor: s.ground }}
              >
                {isSelected && (
                  <Check
                    size={18}
                    strokeWidth={3}
                    style={{ color: s.ink }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Alignment Segmented Control */}
        <div className="flex w-full rounded-2xl bg-surface-container-high p-1">
          {(
            [
              { value: "left", label: getString("lyrics_share_align_left"), icon: <AlignLeft size={16} /> },
              { value: "center", label: getString("lyrics_share_align_center"), icon: <AlignCenter size={16} /> },
              { value: "right", label: getString("lyrics_share_align_right"), icon: <AlignRight size={16} /> },
            ] as const
          ).map(({ value, label, icon }) => {
            const isSelected = align === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setAlign(value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all ${
                  isSelected
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm"
                    : "text-chrome-neutral-400 hover:text-white"
                }`}
              >
                {icon}
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </LyricsDialog>
  );
}
