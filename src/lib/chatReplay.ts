import type { LiveChatMessage } from "../types/video";

/**
 * A jump bigger than this between two clock readings is a seek, not playback. Backwards too:
 * a seek lands on the keyframe a few seconds before where it was asked to.
 */
export const SEEK_THRESHOLD_MS = 5000;
/** How far ahead of the playhead replayed messages are fetched. */
export const LOOKAHEAD_MS = 15000;
export const MAX_REPLAY_MESSAGES = 200;
/** Messages kept around the playhead across seeks; the farthest from it go first. */
export const MAX_BUFFERED_MESSAGES = 2000;

export function isSeek(previousMs: number | null, nowMs: number): boolean {
  if (previousMs == null) return false;
  return Math.abs(nowMs - previousMs) > SEEK_THRESHOLD_MS;
}

/**
 * `buffer` with `incoming` merged in by id, in stream order, keeping the
 * `MAX_BUFFERED_MESSAGES` nearest to `nowMs`.
 */
export function mergeReplay(buffer: LiveChatMessage[], incoming: LiveChatMessage[], nowMs: number): LiveChatMessage[] {
  const seen = new Set(buffer.map((message) => message.id));
  const offset = (message: LiveChatMessage) => message.videoOffsetMs ?? 0;
  let merged = [...buffer, ...incoming.filter((message) => !seen.has(message.id))];
  if (merged.length > MAX_BUFFERED_MESSAGES) {
    merged = merged
      .sort((a, b) => Math.abs(offset(a) - nowMs) - Math.abs(offset(b) - nowMs))
      .slice(0, MAX_BUFFERED_MESSAGES);
  }
  return merged.sort((a, b) => offset(a) - offset(b));
}

/** The messages sent by `nowMs` into the stream, newest last. */
export function replayedBy(buffer: LiveChatMessage[], nowMs: number): LiveChatMessage[] {
  const shown = buffer.filter((message) => (message.videoOffsetMs ?? 0) <= nowMs);
  return shown.length > MAX_REPLAY_MESSAGES ? shown.slice(shown.length - MAX_REPLAY_MESSAGES) : shown;
}

/** Whether the buffer runs out within the lookahead of `nowMs`. */
export function needsMore(buffer: LiveChatMessage[], nowMs: number): boolean {
  const last = buffer[buffer.length - 1]?.videoOffsetMs ?? -1;
  return last < nowMs + LOOKAHEAD_MS;
}
