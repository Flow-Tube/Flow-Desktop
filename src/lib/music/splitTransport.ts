/**
 * Android's split transport: Previous and Next are the two sides of a split button around
 * Play/pause, round on the outside and nearly flat towards it, trading width as one is pressed.
 * Numbers from Android's `MediaPlaybackControls` and Material's split button tokens.
 */

export type TransportPart = "previous" | "play" | "next";

/** The inner corner facing Play/pause, and how far it opens while pressed. */
export const SPLIT_INNER_CORNER = 8;
export const SPLIT_INNER_CORNER_PRESSED = 20;
/** Gap between the parts. */
export const SPLIT_GAP = 4;

/** Flex weights of Previous, Play/pause and Next for whichever part is held. */
export function splitWeights(pressed: TransportPart | null): Record<TransportPart, number> {
  if (pressed === "play") return { previous: 0.35, play: 1.9, next: 0.35 };
  if (pressed === "previous") return { previous: 0.65, play: 1.1, next: 0.45 };
  if (pressed === "next") return { previous: 0.45, play: 1.1, next: 0.65 };
  return { previous: 0.45, play: 1.3, next: 0.45 };
}

/** CSS border-radius for a side, outer corners fully round; `pressed` 0..1 opens the inner ones. */
export function splitSideRadius(leading: boolean, height: number, pressed: number): string {
  const outer = height / 2;
  const inner = Math.max(0, SPLIT_INNER_CORNER + (SPLIT_INNER_CORNER_PRESSED - SPLIT_INNER_CORNER) * pressed);
  return leading ? `${outer}px ${inner}px ${inner}px ${outer}px` : `${inner}px ${outer}px ${outer}px ${inner}px`;
}

/** Play/pause is a round-ended pill while paused and a rounded square while playing (18 of 68 on Android). */
export function playCornerRadius(height: number, playing: boolean): number {
  return playing ? Math.round((height * 18) / 68) : height / 2;
}
