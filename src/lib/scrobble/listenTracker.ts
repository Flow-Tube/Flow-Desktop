import type { SongItem } from "../../types/music";

const MIN_DURATION_MS = 30_000;
const MAX_THRESHOLD_MS = 4 * 60_000;
// A store update normally lands every quarter second; a longer gap means the machine slept or
// the clock jumped, which is not listening.
const MAX_STEP_MS = 5_000;
// Progress falling from the last seconds back to the start of the same song is a repeat.
const REPEAT_WINDOW_SECONDS = 5;

/** Mirrors the backend rule: half the track or four minutes, and never for 30 s or less. */
export function listenThresholdMs(durationMs: number): number | null {
  return durationMs > MIN_DURATION_MS ? Math.min(Math.floor(durationMs / 2), MAX_THRESHOLD_MS) : null;
}

export interface PlayerSnapshot {
  track: SongItem | null;
  playing: boolean;
  buffering: boolean;
  /** Seconds, from the element's timeupdate. */
  progress: number;
  /** Seconds, from the element; 0 until known. */
  duration: number;
}

export type ListenEvent =
  | { kind: "nowPlaying"; track: SongItem; durationMs: number }
  | { kind: "listened"; track: SongItem; durationMs: number; playedMs: number; startedAtMs: number };

interface Session {
  key: string;
  track: SongItem;
  startedAtMs: number;
  startProgress: number;
  lastProgress: number;
  playedMs: number;
  audibleSince: number | null;
  announced: boolean;
  counted: boolean;
}

const songKey = (song: SongItem) => song.videoId ?? song.id;

function durationMs(snapshot: PlayerSnapshot, track: SongItem): number {
  const seconds = snapshot.duration > 0 ? snapshot.duration : track.duration ?? 0;
  return seconds * 1000;
}

/**
 * Counts one listen per play of a song by the time it was actually audible: pauses, buffering
 * and seeks don't count, and a repeat starts a new listen. Now playing goes out once audio
 * really starts; the listen goes out the moment it reaches the threshold.
 */
export class ListenTracker {
  private session: Session | null = null;

  update(snapshot: PlayerSnapshot, nowMs: number): ListenEvent[] {
    const { track } = snapshot;
    if (!track) {
      this.session = null;
      return [];
    }

    let session = this.session;
    const repeated = session !== null
      && session.key === songKey(track)
      && snapshot.progress + REPEAT_WINDOW_SECONDS < session.lastProgress
      && session.lastProgress >= durationMs(snapshot, track) / 1000 - REPEAT_WINDOW_SECONDS;
    if (!session || session.key !== songKey(track) || repeated) {
      session = {
        key: songKey(track),
        track,
        startedAtMs: nowMs,
        startProgress: snapshot.progress,
        lastProgress: snapshot.progress,
        playedMs: 0,
        audibleSince: null,
        announced: false,
        counted: false,
      };
      this.session = session;
    }

    if (session.audibleSince !== null) {
      session.playedMs += Math.min(Math.max(0, nowMs - session.audibleSince), MAX_STEP_MS);
    }
    const audible = snapshot.playing && !snapshot.buffering;
    session.audibleSince = audible ? nowMs : null;

    const events: ListenEvent[] = [];
    const length = durationMs(snapshot, track);
    if (!session.announced && audible && snapshot.progress !== session.startProgress) {
      session.announced = true;
      events.push({ kind: "nowPlaying", track, durationMs: length });
    }
    const threshold = listenThresholdMs(length);
    if (!session.counted && threshold !== null && session.playedMs >= threshold) {
      session.counted = true;
      events.push({
        kind: "listened",
        track,
        durationMs: length,
        playedMs: session.playedMs,
        startedAtMs: session.startedAtMs,
      });
    }
    session.lastProgress = snapshot.progress;
    return events;
  }
}
