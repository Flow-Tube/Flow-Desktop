import type { VideoFit } from "../../store/usePlayerStore";

/** The same bounds as Flow for Android's pinch (`VideoPlayerZoom.kt`), so both apps zoom alike. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
/** A zoom this close to 1x settles back to exactly 1x. */
export const ZOOM_RESET_THRESHOLD = 1.02;
/** How close to the fill scale, as a share of it, the zoom locks onto it. */
const FILL_DETENT = 0.04;
/** Below this fill scale the picture already nearly fills the frame, so there is nothing to snap to. */
const FILL_MIN = 1.02;
/** One key press, menu click or wheel notch. */
export const ZOOM_STEP = 1.25;
/** A key press pans by this share of the frame. */
export const PAN_STEP = 0.1;
/** W, A, S and D look around a 360 video; on a zoomed one they show more of that side. */
export const PAN_KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  w: [0, 1],
  a: [1, 0],
  s: [0, -1],
  d: [-1, 0],
};

/** `translate(x, y) scale(scale)` about the frame's centre; x and y are in CSS pixels. */
export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

/** The frame, and the picture's size inside it at 1x. */
export interface ZoomFrame {
  width: number;
  height: number;
  pictureWidth: number;
  pictureHeight: number;
}

export const UNZOOMED: ZoomState = { scale: 1, x: 0, y: 0 };

/** Where the video sits in a frame of this size under each Resize choice. */
export function zoomFrame(width: number, height: number, videoWidth: number, videoHeight: number, fit: VideoFit): ZoomFrame {
  if (fit === "fill" || videoWidth <= 0 || videoHeight <= 0) return { width, height, pictureWidth: width, pictureHeight: height };
  const ratio = fit === "zoom"
    ? Math.max(width / videoWidth, height / videoHeight)
    : Math.min(width / videoWidth, height / videoHeight);
  return { width, height, pictureWidth: videoWidth * ratio, pictureHeight: videoHeight * ratio };
}

/** The scale at which the picture covers the frame edge to edge, or null when it already nearly does. */
export function fillScale(frame: ZoomFrame): number | null {
  if (frame.pictureWidth <= 0 || frame.pictureHeight <= 0) return null;
  const fill = Math.max(frame.width / frame.pictureWidth, frame.height / frame.pictureHeight);
  return fill >= FILL_MIN ? fill : null;
}

/** `scale`, or exactly the fill scale when it is within the detent around it. */
export function snapToFill(scale: number, fill: number | null): number {
  return fill !== null && Math.abs(scale / fill - 1) <= FILL_DETENT ? fill : scale;
}

/** Keeps the picture's edges outside the frame, so no bar or background pans into view. */
export function clampPan(state: ZoomState, frame: ZoomFrame): ZoomState {
  const limitX = Math.max(0, (frame.pictureWidth * state.scale - frame.width) / 2);
  const limitY = Math.max(0, (frame.pictureHeight * state.scale - frame.height) / 2);
  return {
    scale: state.scale,
    x: Math.min(limitX, Math.max(-limitX, state.x)),
    y: Math.min(limitY, Math.max(-limitY, state.y)),
  };
}

/**
 * Zooms by `factor`, keeping the point at `focus` (relative to the frame's centre) where it is,
 * snapping to the fill scale and settling back to 1x near it.
 */
export function zoomAbout(state: ZoomState, factor: number, focus: { x: number; y: number }, frame: ZoomFrame): ZoomState {
  let scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.scale * factor));
  scale = snapToFill(scale, fillScale(frame));
  if (scale < ZOOM_RESET_THRESHOLD) return UNZOOMED;
  const ratio = scale / state.scale;
  return clampPan(
    { scale, x: focus.x - (focus.x - state.x) * ratio, y: focus.y - (focus.y - state.y) * ratio },
    frame,
  );
}

export function panBy(state: ZoomState, dx: number, dy: number, frame: ZoomFrame): ZoomState {
  if (state.scale === 1) return state;
  return clampPan({ scale: state.scale, x: state.x + dx, y: state.y + dy }, frame);
}

export function isAtFill(state: ZoomState, frame: ZoomFrame): boolean {
  const fill = fillScale(frame);
  return fill !== null && state.scale === fill;
}

/** The CSS transform for a zoom, or "" at 1x so an unzoomed video gets no transform at all. */
export function zoomTransform(state: ZoomState): string {
  if (state.scale === 1) return "";
  return `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
}

/** The part of the video, in its own pixels, that the frame shows; null when it shows all of it. */
export function visibleVideoRect(
  state: ZoomState,
  frame: ZoomFrame,
  videoWidth: number,
  videoHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  if (state.scale === 1 || frame.pictureWidth <= 0 || frame.pictureHeight <= 0) return null;
  const axis = (frameSize: number, pictureSize: number, offset: number, videoSize: number) => {
    const half = pictureSize / 2;
    const from = Math.max(-half, (-frameSize / 2 - offset) / state.scale);
    const to = Math.min(half, (frameSize / 2 - offset) / state.scale);
    const perPx = videoSize / pictureSize;
    return [Math.round((from + half) * perPx), Math.round((to - from) * perPx)] as const;
  };
  const [x, width] = axis(frame.width, frame.pictureWidth, state.x, videoWidth);
  const [y, height] = axis(frame.height, frame.pictureHeight, state.y, videoHeight);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
