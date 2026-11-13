/** Double-click and arrow-key seek feedback, after Android's SeekAnimationOverlay. */

export type SeekDirection = "forward" | "backward";

export type SeekFeedback = {
  /** New on every step, so the tint flashes again. */
  id: number;
  direction: SeekDirection;
  /** The running total of this burst. */
  seconds: number;
  /** False while the label fades out; the total is kept so it doesn't jump back to one step. */
  visible: boolean;
};

/** Android's DOUBLE_TAP_SEEK_WINDOW_MS: how long the label stays after the last step. */
export const SEEK_FEEDBACK_WINDOW_MS = 800;
/** After the label hides, how long its total is kept for the fade-out. */
export const SEEK_TOTAL_RESET_MS = 400;
/** How much of the player's width each seek side takes, for clicks and for the tint. */
export const SEEK_ZONE_FRACTION = 0.35;

/** Another step on the side that is showing adds up; anything else starts a new total. */
export function nextSeekFeedback(previous: SeekFeedback | null, direction: SeekDirection, step: number): SeekFeedback {
  const continuing = previous !== null && previous.visible && previous.direction === direction;
  return {
    id: (previous?.id ?? 0) + 1,
    direction,
    seconds: continuing ? previous.seconds + step : step,
    visible: true,
  };
}

/** Which seek side a click at `x` across a layer `width` wide falls on, or null for the middle. */
export function seekSideAt(x: number, width: number): SeekDirection | null {
  if (width <= 0) return null;
  if (x < width * SEEK_ZONE_FRACTION) return "backward";
  if (x > width * (1 - SEEK_ZONE_FRACTION)) return "forward";
  return null;
}

/**
 * The tint is a circle clipped to the seek side: flush with the player's edge, bulging toward the
 * middle. This is the smallest radius whose circle still covers both corners on the flush edge, so
 * no sliver of untinted video is left at the border.
 */
export function seekRippleClipPath(zoneWidth: number, height: number, direction: SeekDirection): string | undefined {
  if (zoneWidth <= 0 || height <= 0) return undefined;
  const radius = zoneWidth / 2 + (height * height) / (8 * zoneWidth);
  const centerX = direction === "forward" ? radius : zoneWidth - radius;
  return `circle(${radius}px at ${centerX}px 50%)`;
}
