import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import { IS_LINUX_RUNTIME } from "../platform";

/**
 * On WebKitGTK the video paints nothing for a moment after a seek or a speed change (#696): the
 * pipeline flush drops the frame on screen before the next one is decoded, and the player's black
 * background shows through. A copy of the last frame on a canvas above the video covers that gap.
 * WebView2 and WKWebView keep their last frame, so the hold runs on Linux only.
 */

export type FrameHoldChange = { kind: "seek"; target: number } | { kind: "rate" };

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const HOLD_TIMEOUT_MS = 1500;
/** A frame this close to the seek target belongs to the new position. */
const SEEK_TARGET_TOLERANCE_SECONDS = 1;

/**
 * The canvas keeps the video's shape, so the fit class lays it out exactly like the video, but holds no
 * more pixels than the video has or than the screen area it covers. Cover fit crops one side, so the
 * larger of the two scales keeps that side sharp.
 */
export function heldFrameSize(
  videoWidth: number,
  videoHeight: number,
  boxWidth: number,
  boxHeight: number,
  pixelRatio: number,
): { width: number; height: number } | null {
  if (!(videoWidth > 0 && videoHeight > 0 && boxWidth > 0 && boxHeight > 0)) return null;
  const scale = Math.min(1, Math.max((boxWidth * pixelRatio) / videoWidth, (boxHeight * pixelRatio) / videoHeight));
  return { width: Math.max(1, Math.round(videoWidth * scale)), height: Math.max(1, Math.round(videoHeight * scale)) };
}

/**
 * Whether a newly presented frame shows the state after the change. After a speed change WebKitGTK
 * still presents one frame from before the flush (4 to 13 ms after the write in the lab), so the hold
 * waits for the second one.
 */
export function frameEndsHold(
  change: FrameHoldChange,
  mediaTime: number,
  framesSinceChange: number,
  seeked: boolean,
): boolean {
  if (change.kind === "seek") return seeked && Math.abs(mediaTime - change.target) <= SEEK_TARGET_TOLERANCE_SECONDS;
  return framesSinceChange >= 2;
}

export interface FrameHold {
  enabled: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Shows the frame on screen, runs `write` (the seek or rate change), and lets go once a new frame is up. */
  around: (change: FrameHoldChange, write: () => void) => void;
  release: () => void;
}

export function useFrameHold(videoRef: RefObject<HTMLVideoElement | null>, enabled = IS_LINUX_RUNTIME): FrameHold {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const holdingRef = useRef(false);

  const release = useCallback(() => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    holdingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.hidden = true;
    // A hidden canvas still keeps its pixels; dropping them frees up to a 4K frame between holds.
    canvas.width = 0;
  }, []);

  const show = useCallback((video: FrameCallbackVideo, canvas: HTMLCanvasElement): boolean => {
    if (video.readyState < 2 || typeof video.requestVideoFrameCallback !== "function") return false;
    const size = heldFrameSize(
      video.videoWidth,
      video.videoHeight,
      video.clientWidth,
      video.clientHeight,
      window.devicePixelRatio || 1,
    );
    if (!size) return false;
    try {
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return false;
      context.drawImage(video, 0, 0, size.width, size.height);
    } catch {
      return false;
    }
    // Zoom transforms the video element directly; the held frame has to sit where the video was.
    canvas.style.transform = video.style.transform;
    canvas.hidden = false;
    holdingRef.current = true;
    return true;
  }, []);

  const watch = useCallback(
    (video: FrameCallbackVideo, change: FrameHoldChange) => {
      stopWatchRef.current?.();
      let frames = 0;
      let seeked = change.kind !== "seek";
      let handle: number | null = null;
      const onSeeked = () => {
        seeked = true;
      };
      const onFrame = (_now: number, metadata: { mediaTime: number }) => {
        frames += 1;
        if (frameEndsHold(change, metadata.mediaTime, frames, seeked)) release();
        else handle = video.requestVideoFrameCallback!(onFrame);
      };
      const timer = window.setTimeout(release, HOLD_TIMEOUT_MS);
      if (change.kind === "seek") video.addEventListener("seeked", onSeeked);
      handle = video.requestVideoFrameCallback!(onFrame);
      stopWatchRef.current = () => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        if (handle !== null) video.cancelVideoFrameCallback?.(handle);
      };
    },
    [release],
  );

  const around = useCallback(
    (change: FrameHoldChange, write: () => void) => {
      const video = videoRef.current as FrameCallbackVideo | null;
      const canvas = canvasRef.current;
      // A change during a hold keeps the frame already up: the video may show nothing by now.
      const holding = enabled && video && canvas && (holdingRef.current || show(video, canvas));
      write();
      if (holding) watch(video, change);
    },
    [enabled, show, videoRef, watch],
  );

  useEffect(() => release, [release]);

  return useMemo(() => ({ enabled, canvasRef, around, release }), [enabled, around, release]);
}
