import { seekWhenVideoReady } from "./playerSeek";

// The card preview playing now and how far it got. Only one plays at a time.
let current: { videoId: string; seconds: number } | null = null;

export function notePreviewPosition(videoId: string, seconds: number): void {
  current = { videoId, seconds };
}

export function clearPreviewPosition(videoId: string): void {
  if (current?.videoId === videoId) current = null;
}

/**
 * Opening a video whose card was previewing carries on from the preview's second, as YouTube
 * does. A preview of a second or less isn't worth skipping into.
 */
export function continueFromPreview(videoId: string): void {
  const seconds = current?.videoId === videoId ? current.seconds : 0;
  current = null;
  if (seconds > 1) seekWhenVideoReady(seconds);
}
