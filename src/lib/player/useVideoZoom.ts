import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import type { VideoFit } from "../../store/usePlayerStore";
import {
  PAN_STEP,
  UNZOOMED,
  clampPan,
  isAtFill,
  panBy as panState,
  visibleVideoRect,
  zoomAbout,
  zoomFrame,
  zoomTransform,
  type ZoomFrame,
  type ZoomState,
} from "./videoZoom";

export interface ZoomReadout {
  /** Changes on every zoom, so the read-out restarts its fade. */
  id: number;
  scale: number;
  atFill: boolean;
}

export interface VideoZoom {
  /** False in the mini player and for 360 videos, which keep their own field-of-view zoom. */
  enabled: boolean;
  zoomed: boolean;
  /** Zooms about a point on screen, or about the centre without one. */
  zoomBy: (factor: number, clientX?: number, clientY?: number) => void;
  /** Pans by screen pixels. False when there is nothing to pan. */
  panBy: (dx: number, dy: number) => boolean;
  /** Pans by a tenth of the frame per step, for the keys. */
  panStep: (stepsX: number, stepsY: number) => boolean;
  reset: () => void;
  isZoomed: () => boolean;
  /** The part of the video on screen, in the video's own pixels; null when all of it shows. */
  visibleRect: () => { x: number; y: number; width: number; height: number } | null;
  subscribeReadout: (listener: () => void) => () => void;
  readout: () => ZoomReadout | null;
}

interface UseVideoZoomOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The element the video fills; it isn't transformed itself. */
  frameRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  videoFit: VideoFit;
  /** A new value starts the video unzoomed again: the video's id. */
  resetKey: string | undefined;
}

/**
 * Free zoom and pan for the video, as Flow for Android's pinch. The transform is written straight to
 * the video element, never through React, so a pinch doesn't re-render the player; at 1x the element
 * has no transform at all, which keeps the compositor's layers as they were before zoom existed.
 */
export function useVideoZoom({ videoRef, frameRef, enabled, videoFit, resetKey }: UseVideoZoomOptions): VideoZoom {
  const stateRef = useRef<ZoomState>(UNZOOMED);
  const readoutRef = useRef<ZoomReadout | null>(null);
  const listenersRef = useRef(new Set<() => void>());
  const fitRef = useRef(videoFit);
  fitRef.current = videoFit;
  const [zoomed, setZoomed] = useState(false);

  const frame = useCallback((): ZoomFrame | null => {
    const element = frameRef.current;
    const video = videoRef.current;
    if (!element || !video || element.clientWidth <= 0 || element.clientHeight <= 0) return null;
    return zoomFrame(element.clientWidth, element.clientHeight, video.videoWidth, video.videoHeight, fitRef.current);
  }, [frameRef, videoRef]);

  const apply = useCallback(
    (next: ZoomState, box: ZoomFrame | null, announce: boolean) => {
      stateRef.current = next;
      const video = videoRef.current;
      if (video) video.style.transform = zoomTransform(next);
      setZoomed(next.scale !== 1);
      if (!announce) return;
      readoutRef.current = { id: (readoutRef.current?.id ?? 0) + 1, scale: next.scale, atFill: box ? isAtFill(next, box) : false };
      listenersRef.current.forEach((listener) => listener());
    },
    [videoRef],
  );

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const box = frame();
      if (!enabled || !box || !Number.isFinite(factor) || factor <= 0) return;
      const rect = frameRef.current!.getBoundingClientRect();
      const focus =
        clientX === undefined || clientY === undefined
          ? { x: 0, y: 0 }
          : { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
      apply(zoomAbout(stateRef.current, factor, focus, box), box, true);
    },
    [apply, enabled, frame, frameRef],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const box = frame();
      if (!enabled || !box || stateRef.current.scale === 1) return false;
      apply(panState(stateRef.current, dx, dy, box), box, false);
      return true;
    },
    [apply, enabled, frame],
  );

  const panStep = useCallback(
    (stepsX: number, stepsY: number) => {
      const element = frameRef.current;
      if (!element) return false;
      return panBy(stepsX * PAN_STEP * element.clientWidth, stepsY * PAN_STEP * element.clientHeight);
    },
    [frameRef, panBy],
  );

  const reset = useCallback(() => {
    if (stateRef.current.scale === 1) return;
    apply(UNZOOMED, frame(), true);
  }, [apply, frame]);

  // A new video, the mini player and a 360 view all start unzoomed.
  useEffect(() => {
    if (stateRef.current.scale !== 1) apply(UNZOOMED, null, false);
  }, [apply, enabled, resetKey]);

  // Theater, fullscreen, a new Resize choice or a window resize change the frame under a zoom.
  useEffect(() => {
    const element = frameRef.current;
    if (!element || !zoomed) return;
    const refit = () => {
      const box = frame();
      if (box && stateRef.current.scale !== 1) apply(clampPan(stateRef.current, box), box, false);
    };
    refit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [apply, frame, frameRef, videoFit, zoomed]);

  const subscribeReadout = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  return useMemo(
    () => ({
      enabled,
      zoomed,
      zoomBy,
      panBy,
      panStep,
      reset,
      isZoomed: () => stateRef.current.scale !== 1,
      visibleRect: () => {
        const box = frame();
        const video = videoRef.current;
        return box && video ? visibleVideoRect(stateRef.current, box, video.videoWidth, video.videoHeight) : null;
      },
      subscribeReadout,
      readout: () => readoutRef.current,
    }),
    [enabled, frame, panBy, panStep, reset, subscribeReadout, videoRef, zoomBy, zoomed],
  );
}

/** The latest zoom change, for the read-out. Only the read-out re-renders on each pinch step. */
export function useZoomReadout(zoom: VideoZoom): ZoomReadout | null {
  return useSyncExternalStore(zoom.subscribeReadout, zoom.readout, () => null);
}
