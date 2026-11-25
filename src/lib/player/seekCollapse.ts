/** The seek bar's drawn height, and the strip it thins to while the controls are hidden. */
export const SEEK_BAR_HEIGHT_PX = 5;
export const SEEK_STRIP_HEIGHT_PX = 3;

export interface SeekCollapseBox {
  /** The controls layer, which covers the whole player. */
  layerWidth: number;
  layerHeight: number;
  /** The seek track's layout box inside that layer, before any transform. */
  trackLeft: number;
  trackTop: number;
  trackWidth: number;
  trackHeight: number;
}

export interface SeekCollapseTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Moves the seek track from its place above the buttons to a strip along the player's
 * bottom edge, as wide as the player. Scaling is about the track's centre, where the bar
 * itself is drawn, so the bar's bottom lands on the edge.
 */
export function collapsedSeekTransform(box: SeekCollapseBox): SeekCollapseTransform | null {
  if (box.trackWidth <= 0 || box.trackHeight <= 0 || box.layerWidth <= 0 || box.layerHeight <= 0) return null;
  const centreX = box.trackLeft + box.trackWidth / 2;
  const centreY = box.trackTop + box.trackHeight / 2;
  return {
    x: box.layerWidth / 2 - centreX,
    y: box.layerHeight - SEEK_STRIP_HEIGHT_PX / 2 - centreY,
    scaleX: box.layerWidth / box.trackWidth,
    scaleY: SEEK_STRIP_HEIGHT_PX / SEEK_BAR_HEIGHT_PX,
  };
}

/** Writes the transform as the CSS variables `.seek-track-collapsible` reads. */
export function applySeekCollapse(track: HTMLElement, transform: SeekCollapseTransform | null) {
  if (!transform) return;
  track.style.setProperty("--seek-collapse-x", `${transform.x}px`);
  track.style.setProperty("--seek-collapse-y", `${transform.y}px`);
  track.style.setProperty("--seek-collapse-sx", String(transform.scaleX));
  track.style.setProperty("--seek-collapse-sy", String(transform.scaleY));
}

/** The track's untransformed box in its offset parent, which is the controls layer. */
export function measureSeekCollapse(track: HTMLElement): SeekCollapseTransform | null {
  const layer = track.offsetParent;
  if (!(layer instanceof HTMLElement)) return null;
  return collapsedSeekTransform({
    layerWidth: layer.clientWidth,
    layerHeight: layer.clientHeight,
    trackLeft: track.offsetLeft,
    trackTop: track.offsetTop,
    trackWidth: track.offsetWidth,
    trackHeight: track.offsetHeight,
  });
}

/**
 * Keeps the collapse transform current while the player, the track or the controls
 * under it change size (theatre, fullscreen, a window resize, a wrapped row). Returns
 * the cleanup.
 */
export function watchSeekCollapse(track: HTMLElement): () => void {
  const update = () => applySeekCollapse(track, measureSeekCollapse(track));
  update();
  if (typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(update);
  for (const node of [track, track.parentElement, track.offsetParent]) {
    if (node instanceof HTMLElement) observer.observe(node);
  }
  return () => observer.disconnect();
}
