// Drawing the seek bar every animation frame costs layout and style work 60 to
// 144 times a second, so the controls only do it while the bar is moving where
// someone can see it, and otherwise follow the media element's events.

/** Media events that move the playhead or change what the bar shows. */
export const PROGRESS_EVENTS = [
  "timeupdate",
  "seeked",
  "durationchange",
  "loadedmetadata",
  "play",
  "pause",
] as const;

export function shouldAnimateProgress(isPlaying: boolean, visible: boolean, scrubbing: boolean): boolean {
  return scrubbing || (isPlaying && visible);
}

/** How full one chapter segment's bar is, in percent, at `time` seconds. */
export function segmentFillPercent(time: number, start: number, end: number): number {
  if (time > end) return 100;
  if (time < start || end <= start) return 0;
  return ((time - start) / (end - start)) * 100;
}

/** Writes an inline style only when it changes, so an idle frame does no style work. */
export function setStyleIfChanged(
  element: HTMLElement | null | undefined,
  property: "width" | "left" | "display",
  value: string,
): void {
  if (element && element.style[property] !== value) element.style[property] = value;
}

export function setTextIfChanged(element: HTMLElement | null | undefined, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

/**
 * Whether a timeupdate counts toward the current video. After a switch the media
 * element still plays the previous stream until the new one is loaded, and its
 * position must not be filed under the new video.
 */
export function progressTickBelongsTo(currentVideoId: string | null, streamVideoId: string | null): boolean {
  return currentVideoId !== null && currentVideoId === streamVideoId;
}

/**
 * Whether a timeupdate is a real playback position. Changing the source resets
 * the element to 0 and fires timeupdate before the new source has loaded, and a
 * swap that waits to seek to its resume point is paused at 0 until it can.
 * Publishing those ticks saved 0 as the watch position and made the next
 * recovery start the video over.
 */
export function shouldPublishPlaybackTime(switchingSource: boolean, readyState: number, hasSource: boolean): boolean {
  return hasSource && !switchingSource && readyState > 0;
}

/**
 * Where a recovery resumes. Until the source it replaced has played, the
 * position it was handed is the only true one; afterwards it is the last time
 * the player published.
 */
export function recoveryPosition(lastPlayedTime: number, pendingResume: number | null): number {
  return pendingResume ?? lastPlayedTime;
}
