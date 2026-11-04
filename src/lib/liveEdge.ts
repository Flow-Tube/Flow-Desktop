/** Where a live stream's playable range and live edge are, in player-timeline seconds. */
export interface LiveWindow {
  start: number;
  end: number;
}

export interface LiveTiming {
  /** How far behind the window's end playback rests when it is live. */
  holdBackSeconds: number;
  /** How far behind the end still counts as live. */
  edgeSlackSeconds: number;
}

/** Until a playlist has reported its timing, and for live DASH, which never does. */
const DEFAULT_LIVE_TIMING: LiveTiming = { holdBackSeconds: 1, edgeSlackSeconds: 8 };

export function liveWindow(video: Pick<HTMLVideoElement, "seekable">): LiveWindow {
  const len = video.seekable.length;
  if (!len) return { start: 0, end: 0 };
  return { start: video.seekable.start(0), end: video.seekable.end(len - 1) };
}

/**
 * hls.js rests a few segments behind the end, so what counts as live depends on the segment
 * length: about 6 s at 2 s segments and 15 s at 5 s. The end also jumps a segment at each playlist
 * refresh, hence the extra slack.
 */
export function liveTimingFromPlaylist(targetLatency: number | null, targetDuration: number): LiveTiming {
  const holdBackSeconds = targetLatency ?? targetDuration * 3;
  return { holdBackSeconds, edgeSlackSeconds: holdBackSeconds + targetDuration * 1.5 };
}

export function stampLiveTiming(video: HTMLVideoElement, timing: LiveTiming): void {
  video.dataset.liveHoldBack = String(timing.holdBackSeconds);
  video.dataset.liveEdgeSlack = String(timing.edgeSlackSeconds);
}

export function clearLiveTiming(video: HTMLVideoElement): void {
  delete video.dataset.liveHoldBack;
  delete video.dataset.liveEdgeSlack;
}

export function readLiveTiming(video: Pick<HTMLVideoElement, "dataset">): LiveTiming {
  const holdBackSeconds = Number(video.dataset.liveHoldBack);
  const edgeSlackSeconds = Number(video.dataset.liveEdgeSlack);
  return holdBackSeconds > 0 && edgeSlackSeconds > 0
    ? { holdBackSeconds, edgeSlackSeconds }
    : DEFAULT_LIVE_TIMING;
}

export function isAtLiveEdge(position: number, end: number, timing: LiveTiming): boolean {
  return end - position <= timing.edgeSlackSeconds;
}

export function secondsBehindLive(position: number, end: number, timing: LiveTiming): number {
  return Math.max(0, Math.round(end - timing.holdBackSeconds - position));
}

export function liveEdgePosition(window: LiveWindow, timing: LiveTiming): number {
  return Math.max(window.start, window.end - timing.holdBackSeconds);
}

/**
 * Where a stalled live stream should jump to, if anywhere. Falling off the start of the window
 * always needs a jump. Otherwise it catches up to live, unless the viewer chose to be behind.
 */
export function liveStallRecoveryTarget({
  position,
  window,
  syncPosition,
  seekedBack,
}: {
  position: number;
  window: LiveWindow;
  syncPosition: number | null;
  seekedBack: boolean;
}): number | null {
  if (position < window.start) return window.start + 1;
  if (seekedBack) return null;
  const target = syncPosition != null && Number.isFinite(syncPosition) ? syncPosition : window.end - 4;
  return target > position ? target : null;
}
