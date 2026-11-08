import { useState, useEffect, useRef } from "react";
import { getVideoStoryboard } from "./api/youtube";
import { storyboardFrameAt, type StoryboardFrame } from "./seekPreview";
import type { StoryboardLevel } from "../types/video";
import { useHoverPreviewStore } from "../store/useHoverPreviewStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useImageProxyStore } from "../store/useImageProxyStore";
import { proxiedImage } from "./imageProxy";
import { SETTINGS } from "./settings/schema";

const HOVER_INTENT_DELAY_MS = 500;
export const FRAME_CYCLE_INTERVAL_MS = 250;
export const FRAMES_PER_CLUSTER = 12; // 12 frames * 250ms = 3.0 full seconds per video part
const MAX_STORYBOARD_CACHE_ENTRIES = 100;

/**
 * Determines the number of preview mini-clips (clusters) based on video duration.
 * Limited to at most 3 key video parts (e.g. beginning, middle, later) so each part
 * gets a full 3 seconds of sustained playback without frequent jumping.
 */
export function getPreviewClusterCount(durationSeconds: number): number {
  if (durationSeconds <= 30) return 1;
  if (durationSeconds <= 180) return 2;
  return 3;
}

const storyboardSpecCache = new Map<string, StoryboardLevel[]>();

function cacheStoryboardSpec(videoId: string, levels: StoryboardLevel[]) {
  if (storyboardSpecCache.size >= MAX_STORYBOARD_CACHE_ENTRIES) {
    const oldestKey = storyboardSpecCache.keys().next().value;
    if (oldestKey !== undefined) {
      storyboardSpecCache.delete(oldestKey);
    }
  }
  storyboardSpecCache.set(videoId, levels);
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
  targetWidth?: number;
  targetHeight?: number;
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
  targetWidth,
  targetHeight,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewResult {
  const settingEnabled = useAppSettingsStore(
    (state) => state.values[SETTINGS.VIDEO_HOVER_PREVIEWS_ENABLED] !== "false"
  );
  const activeVideoId = useHoverPreviewStore((state) => state.activeVideoId);
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

  const targetWidthRef = useRef(targetWidth);
  targetWidthRef.current = targetWidth;

  const targetHeightRef = useRef(targetHeight);
  targetHeightRef.current = targetHeight;

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
    if (activeVideoId !== videoId && isPreviewActive) {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current);
        cycleIntervalRef.current = null;
      }
      setIsPreviewActive(false);
      setCurrentFrame(null);
      setCurrentLevel(null);
      setProgressPercent(0);
    }
  }, [activeVideoId, videoId, isPreviewActive]);

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
      if (activeVideoId === videoId) {
        clearActive(videoId);
      }
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
        let levels = storyboardSpecCache.get(videoId);
        if (!levels) {
          levels = await getVideoStoryboard(videoId);
          if (!isMountedRef.current) return;
          if (levels && levels.length > 0) {
            cacheStoryboardSpec(videoId, levels);
          }
        }

        if (!levels || levels.length === 0) {
          clearActive(videoId);
          return;
        }

        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const effectiveHeight =
          targetHeightRef.current && targetHeightRef.current > 0
            ? targetHeightRef.current
            : 180 * dpr;
        const effectiveWidth =
          targetWidthRef.current && targetWidthRef.current > 0
            ? targetWidthRef.current
            : 320 * dpr;

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
        const stepSeconds = Math.max(1, Math.min(level.intervalMs / 1000, 3));

        const frames: StoryboardFrame[] = [];
        for (let c = 0; c < clusterCount; c++) {
          const anchorRatio = clusterCount === 1 ? 0 : c / clusterCount + 0.05;
          const maxAnchor = Math.max(0, totalDuration - FRAMES_PER_CLUSTER * stepSeconds);
          const anchorTime = Math.min(totalDuration * anchorRatio, maxAnchor);
          for (let f = 0; f < FRAMES_PER_CLUSTER; f++) {
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

        cycleIntervalRef.current = setInterval(() => {
          if (!isMountedRef.current) return;
          frameIdx = (frameIdx + 1) % frames.length;
          setCurrentFrame(frames[frameIdx] ?? null);
          setProgressPercent(Math.round(((frameIdx + 1) / frames.length) * 100));
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
