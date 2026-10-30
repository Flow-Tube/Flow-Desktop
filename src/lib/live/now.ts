import type { Now } from "../api/live";

/** A queue travels with at most this many videos (spec/live.md). */
export const QUEUE_LIMIT = 50;

/** What a player has loaded, in the shape both players can give. */
export interface Playing {
  video: string;
  title: string;
  by: string;
  music: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  playing: boolean;
  /** 0 to 1. */
  volume: number;
  queue: string[];
  index: number;
}

/** The part of `queue` around `index` that fits in a message, and the index within it. */
export function queueWindow(queue: string[], index: number): { queue: string[]; index: number } {
  if (queue.length <= QUEUE_LIMIT) return { queue, index: Math.max(0, Math.min(index, queue.length - 1)) };
  const start = Math.max(0, Math.min(index - 10, queue.length - QUEUE_LIMIT));
  return { queue: queue.slice(start, start + QUEUE_LIMIT), index: index - start };
}

export function nowOf(playing: Playing | null): Now {
  if (!playing) {
    return { video: null, title: "", by: "", music: false, link: null, pos: 0, dur: 0, state: "paused", vol: 0, queue: [], index: 0 };
  }
  const window = queueWindow(playing.queue.length > 0 ? playing.queue : [playing.video], playing.index);
  return {
    video: playing.video,
    title: playing.title,
    by: playing.by,
    music: playing.music,
    link: null,
    pos: Math.max(0, Math.round(playing.position * 1000)),
    dur: Math.max(0, Math.round(playing.duration * 1000)),
    state: playing.playing ? "playing" : "paused",
    vol: Math.round(Math.min(1, Math.max(0, playing.volume)) * 100),
    queue: window.queue,
    index: window.index,
  };
}

/** Whether `next` differs from what was last sent in more than the position moving on. */
export function changed(sent: Now | null, sentAtMs: number, next: Now, nowMs: number): boolean {
  if (!sent) return true;
  const { pos: sentPos, ...sentRest } = sent;
  const { pos, ...rest } = next;
  if (JSON.stringify(sentRest) !== JSON.stringify(rest)) return true;
  const expected = sent.state === "playing" ? sentPos + (nowMs - sentAtMs) : sentPos;
  return Math.abs(pos - expected) > 2000;
}
