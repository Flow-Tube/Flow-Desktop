import { useState, useEffect, useRef } from "react";
import { getVideoStoryboard } from "./api/youtube";
import { storyboardFrameAt, type StoryboardFrame } from "./seekPreview";
import type { StoryboardLevel } from "../types/video";
import { useHoverPreviewStore } from "../store/useHoverPreviewStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useImageProxyStore } from "../store/useImageProxyStore";
import { proxiedImage } from "./imageProxy";
import { SETTINGS } from "./settings/schema";

const HOVER_INTENT_DELAY_MS = 400;
export const FRAME_CYCLE_INTERVAL_MS = 125; // 8 FPS (~125ms per frame)
export const TOTAL_PREVIEW_FRAMES = 24; // 24 frames * 125ms = 3.0 seconds exact duration

/**
 * Determines the number of preview timeline sections based on video duration.
 * Distributes the 24 frames across up to 3 sections (Opening: 8 frames, Middle: 8 frames, Later: 8 frames).
 */
export function getPreviewClusterCount(durationSeconds: number): number {
  if (durationSeconds <= 30) return 1;
  if (durationSeconds <= 180) return 2;
  return 3;
}

async function preloadImage(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  if (typeof img.decode === "function") {
    try {
      await img.decode();
      return;
    } catch {
      // Fallback to onload if decode throws or is unsupported
    }
  }
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load storyboard sheet: ${url}`));
  });
}

/**
 * Picks the storyboard level best suited for card hover previews based on card dimensions.
 * Compares the level resolution with the card's pixel height and width to prevent upscaling blur.
 */
export function pickHoverPreviewLevel(
  levels: StoryboardLevel[] | undefined,
  targetHeight = 180,
  targetWidth = 320
): StoryboardLevel | null {
  if (!levels?.length) return null;
  const sorted = [...levels].sort((a, b) => a.height * a.width - b.height * b.width);
  const sufficient = sorted.find((l) => l.height >= targetHeight || l.width >= targetWidth);
  return sufficient || sorted[sorted.length - 1] || null;
}

export interface UseHoverPreviewOptions {
  videoId: string;
  isHovered: boolean;
  durationSeconds?: number | null;
  /** The card's size in device pixels, read when the preview starts rather than on every render. */
  measure?: () => { width: number; height: number } | null;
  enabled?: boolean;
}

export interface UseHoverPreviewResult {
  isPreviewActive: boolean;
  currentFrame: StoryboardFrame | null;
  currentLevel: StoryboardLevel | null;
  progressPercent: number;
}

export function useHoverPreview({
  videoId,
  isHovered,
  durationSeconds,
  measure,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewResult {
  // Off until turned on: each preview asks YouTube for the hovered video's storyboard.
  const settingEnabled = useAppSettingsStore(
    (state) => state.values[SETTINGS.VIDEO_HOVER_PREVIEWS_ENABLED] === "true"
  );
  const isActiveCard = useHoverPreviewStore((state) => state.activeVideoId === videoId);
  const setActiveVideoId = useHoverPreviewStore((state) => state.setActiveVideoId);
  const clearActive = useHoverPreviewStore((state) => state.clearActive);
  const proxyBase = useImageProxyStore((state) => state.base);

  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<StoryboardFrame | null>(null);
  const [currentLevel, setCurrentLevel] = useState<StoryboardLevel | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);

  const isMountedRef = useRef(true);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const measureRef = useRef(measure);
  measureRef.current = measure;

  const durationSecondsRef = useRef(durationSeconds);
  durationSecondsRef.current = durationSeconds;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (cycleIntervalRef.current) clearInterval(cycleIntervalRef.current);
      clearActive(videoId);
    };
  }, [videoId, clearActive]);

  // If another video card became active, deactivate this card immediately
  useEffect(() => {
    if (!isActiveCard && isPreviewActive) {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current);
        cycleIntervalRef.current = null;
      }
      setIsPreviewActive(false);
      setCurrentFrame(null);
      setCurrentLevel(null);
      setProgressPercent(0);
    }
  }, [isActiveCard, isPreviewActive]);

  // Cancellation listeners for window blur and scroll
  useEffect(() => {
    if (!isPreviewActive) return;

    const handleCancel = () => {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current);
        cycleIntervalRef.current = null;
      }
      setIsPreviewActive(false);
      setCurrentFrame(null);
      setCurrentLevel(null);
      setProgressPercent(0);
      clearActive(videoId);
    };

    window.addEventListener("blur", handleCancel);
    window.addEventListener("scroll", handleCancel, { passive: true, capture: true });

    return () => {
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("scroll", handleCancel, { capture: true });
    };
  }, [isPreviewActive, videoId, clearActive]);

  useEffect(() => {
    // Stop any pending hover timer or cycling
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (cycleIntervalRef.current) {
      clearInterval(cycleIntervalRef.current);
      cycleIntervalRef.current = null;
    }

    if (!isHovered || !enabled || !settingEnabled) {
      clearActive(videoId);
      setIsPreviewActive(false);
      setCurrentFrame(null);
      setCurrentLevel(null);
      setProgressPercent(0);
      return;
    }

    // Check prefers-reduced-motion
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    // Start hover intent delay (500 ms)
    hoverTimerRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;

      // Claim global active preview slot
      setActiveVideoId(videoId);

      try {
        // The backend caches each video's storyboard for as long as its signed sheet links last.
        const levels = await getVideoStoryboard(videoId);
        if (!isMountedRef.current) return;

        if (!levels || levels.length === 0) {
          clearActive(videoId);
          return;
        }

        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const size = measureRef.current?.();
        const effectiveHeight = size && size.height > 0 ? size.height : 180 * dpr;
        const effectiveWidth = size && size.width > 0 ? size.width : 320 * dpr;

        const level = pickHoverPreviewLevel(levels, effectiveHeight, effectiveWidth);
        if (!level || !isMountedRef.current) {
          clearActive(videoId);
          return;
        }

        const totalDuration =
          durationSecondsRef.current && durationSecondsRef.current > 0
            ? durationSecondsRef.current
            : (level.count * level.intervalMs) / 1000;

        const clusterCount = getPreviewClusterCount(totalDuration);
        const framesPerCluster = Math.floor(TOTAL_PREVIEW_FRAMES / clusterCount);
        const stepSeconds = Math.max(1, Math.min(level.intervalMs / 1000, 3));

        const frames: StoryboardFrame[] = [];
        for (let c = 0; c < clusterCount; c++) {
          const anchorRatio = clusterCount === 1 ? 0 : c / clusterCount + 0.05;
          const maxAnchor = Math.max(0, totalDuration - framesPerCluster * stepSeconds);
          const anchorTime = Math.min(totalDuration * anchorRatio, maxAnchor);
          for (let f = 0; f < framesPerCluster; f++) {
            const timestamp = Math.min(anchorTime + f * stepSeconds, totalDuration);
            const rawFrame = storyboardFrameAt(level, timestamp);
            const url = proxiedImage(rawFrame.url, proxyBase);
            frames.push({
              ...rawFrame,
              url,
            });
          }
        }

        if (frames.length === 0) {
          clearActive(videoId);
          return;
        }

        // Preload and decode unique sprite sheet URLs before showing preview
        const uniqueUrls = Array.from(new Set(frames.map((f) => f.url)));
        await Promise.all(uniqueUrls.map(preloadImage));

        if (!isMountedRef.current) return;

        // Verify that this video is still active
        const currentActive = useHoverPreviewStore.getState().activeVideoId;
        if (currentActive !== videoId) return;

        let frameIdx = 0;
        setCurrentLevel(level);
        setCurrentFrame(frames[0] ?? null);
        setProgressPercent(Math.round((1 / frames.length) * 100));
        setIsPreviewActive(true);

        const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
        const totalDurationMs = frames.length * FRAME_CYCLE_INTERVAL_MS;

        cycleIntervalRef.current = setInterval(() => {
          if (!isMountedRef.current) return;
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          const elapsed = Math.max(0, now - startTime);
          const currentLoopTime = elapsed % totalDurationMs;
          const nextIdx = Math.min(
            frames.length - 1,
            Math.floor(currentLoopTime / FRAME_CYCLE_INTERVAL_MS)
          );
          if (nextIdx !== frameIdx) {
            frameIdx = nextIdx;
            setCurrentFrame(frames[frameIdx] ?? null);
            setProgressPercent(Math.round(((frameIdx + 1) / frames.length) * 100));
          }
        }, FRAME_CYCLE_INTERVAL_MS);
      } catch {
        if (isMountedRef.current) {
          clearActive(videoId);
          setIsPreviewActive(false);
          setCurrentFrame(null);
          setCurrentLevel(null);
          setProgressPercent(0);
        }
      }
    }, HOVER_INTENT_DELAY_MS);

    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current);
        cycleIntervalRef.current = null;
      }
    };
  }, [
    videoId,
    isHovered,
    enabled,
    settingEnabled,
    proxyBase,
    setActiveVideoId,
    clearActive,
  ]);

  return {
    isPreviewActive,
    currentFrame,
    currentLevel,
    progressPercent,
  };
}
