import type { StreamInfo, VideoSummary } from "../../types/video";
import { invokeBackend } from "./errors";

/** Window label of the pop-out player; must match `commands::pip::PIP_WINDOW_LABEL`. */
export const PIP_WINDOW_LABEL = "pip";

/**
 * Playback handed between the main window and the pop-out player. Both windows
 * run the same bundle in separate JS contexts, so nothing is shared implicitly —
 * the queue travels with the handoff and each side hydrates its own store.
 */
export interface PipSession {
  queue: VideoSummary[];
  currentIndex: number;
  positionSeconds: number;
  playing: boolean;
  alwaysOnTop: boolean;
  /** Settings the main window already read from SQLite. Carried so the pop-out
   * can pick a quality and buffer profile without one round trip per setting. */
  settings: Record<string, string>;
  /** The stream the main window already resolved, so the pop-out reuses it
   * instead of walking the client ladder again for the same video. */
  stream: { info: StreamInfo; resolvedAt: number } | null;
  /** True when the main window is still playing and will hand over on cue: the
   * pop-out warms up silently rather than doubling the audio. */
  silentUntilTakeover: boolean;
}

/** Pop-out → main: playback state, so the watch page stays in step. */
export interface PipProgressPayload {
  videoId: string;
  positionSeconds: number;
  durationSeconds: number;
  playing: boolean;
}

/** Pop-out → main: the queue advanced inside the pop-out. The index is not
 * carried: the two windows' queues can diverge once the pop-out appends an
 * autoplay pick, so the main window places the video in its own queue. */
export interface PipVideoChangedPayload {
  video: VideoSummary;
}

/** Pop-out → main: playback is coming back, at this position. */
export interface PipHandbackPayload {
  videoId: string;
  positionSeconds: number;
  playing: boolean;
  /** True when the user asked to return to the full player rather than just closing. */
  expand: boolean;
}

/** Main → pop-out: stop shadowing, this is the exact position to continue from. */
export interface PipTakeoverPayload {
  positionSeconds: number;
}

export const PIP_EVENTS = {
  /** Backend → pop-out: a new handoff replaced the session it is playing. */
  sessionChanged: "flow:pip-session-changed",
  progress: "flow:pip-progress",
  videoChanged: "flow:pip-video-changed",
  handback: "flow:pip-handback",
  /** Pop-out → main: decoding has started, the swap can happen now. */
  ready: "flow:pip-ready",
  takeover: "flow:pip-takeover",
} as const;

export function openPipWindow(session: PipSession): Promise<void> {
  return invokeBackend("open_pip_window", { session });
}

export function getPipSession(): Promise<PipSession | null> {
  return invokeBackend("pip_session");
}

export function closePipWindow(): Promise<void> {
  return invokeBackend("close_pip_window");
}

export function setPipAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  return invokeBackend("set_pip_always_on_top", { alwaysOnTop });
}

export function markPipWindowReady(): Promise<void> {
  return invokeBackend("pip_window_ready");
}

export function focusMainWindow(): Promise<void> {
  return invokeBackend("focus_main_window");
}
