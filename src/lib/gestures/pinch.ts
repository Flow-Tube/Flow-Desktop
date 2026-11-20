/** One wheel notch, as a zoom factor. */
export const NOTCH_ZOOM = 1.25;

/**
 * The zoom change for one Ctrl+wheel event. A mouse notch is a whole step. A trackpad pinch, which
 * Chromium and WebView2 send as small Ctrl+wheel deltas, follows the fingers.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  if (deltaY === 0) return 1;
  if (deltaMode !== 0 || (Number.isInteger(deltaY) && Math.abs(deltaY) >= 50)) {
    return deltaY < 0 ? NOTCH_ZOOM : 1 / NOTCH_ZOOM;
  }
  return Math.min(2, Math.max(0.5, Math.exp(-deltaY * 0.01)));
}

export interface ZoomInput {
  /** Multiply the current zoom by this. */
  factor: number;
  clientX: number;
  clientY: number;
}

/** WebKit's pinch event on macOS. It isn't in the DOM typings because only WebKit has it. */
interface GestureEventLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Calls `onZoom` for a trackpad pinch or a Ctrl or Cmd wheel over `element`. macOS WebKit reports a
 * pinch as gesture events and Chromium as Ctrl+wheel; both arrive here as one factor per event.
 * `onZoom` returns whether it took the event, and a taken event is cancelled, so the page never
 * zooms itself. A pinch is always cancelled, since the whole page would zoom otherwise.
 */
export function listenForZoomInput(element: HTMLElement | Window, onZoom: (input: ZoomInput) => boolean): () => void {
  // Set while a WebKit pinch runs, so a wheel event WebKit may send alongside it isn't counted twice.
  let pinchScale: number | null = null;

  const onWheel = (event: Event) => {
    if (!(event instanceof WheelEvent) || !(event.ctrlKey || event.metaKey) || pinchScale !== null) return;
    const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
    if (!onZoom({ factor, clientX: event.clientX, clientY: event.clientY })) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onGestureStart = (event: Event) => {
    event.preventDefault();
    pinchScale = 1;
  };
  const onGestureChange = (event: Event) => {
    event.preventDefault();
    const { scale, clientX, clientY } = event as GestureEventLike;
    if (pinchScale === null || !(scale > 0)) return;
    const factor = scale / pinchScale;
    pinchScale = scale;
    onZoom({ factor, clientX, clientY });
  };
  const onGestureEnd = (event: Event) => {
    event.preventDefault();
    pinchScale = null;
  };

  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("gesturestart", onGestureStart);
  element.addEventListener("gesturechange", onGestureChange);
  element.addEventListener("gestureend", onGestureEnd);
  return () => {
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("gesturestart", onGestureStart);
    element.removeEventListener("gesturechange", onGestureChange);
    element.removeEventListener("gestureend", onGestureEnd);
  };
}
