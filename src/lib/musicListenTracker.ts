import type { SongItem } from "../types/music";

/**
 * Counts how long a song actually played, by the wall clock, for history and
 * MusicBrain. Seeks move the playhead but not the clock, and pauses, buffering
 * and a sleeping machine add nothing, so dragging to the end is not a full
 * listen and a song that never started writes no row.
 */

/** A gap between clock ticks longer than this is time the song was not heard. */
export const MAX_TICK_GAP_MS = 5_000;
/** How often a listen in progress is saved, so a crash loses little. */
export const LISTEN_PERSIST_MS = 5_000;

export interface ListenSink {
  /** A listen of `listenedSeconds` (at least one) on `track`, `durationSeconds` long. */
  recordListen: (track: SongItem, listenedSeconds: number, durationSeconds: number) => void;
  /** Where the song was left: on a pause, a change of song, its end or the app closing. */
  recordPosition: (track: SongItem, positionSeconds: number, durationSeconds: number) => void;
}

const idOf = (track: SongItem): string => track.videoId ?? track.id;

export class MusicListenTracker {
  private track: SongItem | null = null;
  private listenedMs = 0;
  private lastTickAt: number | null = null;
  private lastPersistAt = 0;
  private position = 0;
  private duration = 0;
  /** Whether the element has reported a position for this song yet. */
  private ticked = false;

  constructor(private readonly sink: ListenSink) {}

  listenedSeconds(): number {
    return Math.floor(this.listenedMs / 1000);
  }

  /**
   * One `timeupdate` of the playing element. A different song than the one
   * being counted closes that listen first, so a gapless swap credits the song
   * that played rather than the one that just took over.
   */
  tick(track: SongItem, positionSeconds: number, durationSeconds: number, now: number): void {
    if (!this.track || idOf(this.track) !== idOf(track)) this.start(track, now);
    if (this.lastTickAt !== null) {
      const gap = now - this.lastTickAt;
      if (gap > 0 && gap <= MAX_TICK_GAP_MS) this.listenedMs += gap;
    }
    this.lastTickAt = now;
    this.ticked = true;
    this.position = positionSeconds;
    if (durationSeconds > 0) this.duration = durationSeconds;
    if (now - this.lastPersistAt >= LISTEN_PERSIST_MS) {
      this.lastPersistAt = now;
      this.saveListen();
    }
  }

  /** The song stopped making sound (paused or buffering): the clock stops until the next tick. */
  hold(): void {
    this.lastTickAt = null;
  }

  /** The user paused: save the listen so far and where the song was left. */
  pause(): void {
    this.hold();
    this.flush();
  }

  /** The song played to its end. A replay of it (repeat one) counts as a new listen. */
  finish(now: number): void {
    if (!this.track) return;
    this.position = this.duration;
    this.flush();
    this.start(this.track, now);
  }

  /** The player moved to `track` (or to nothing): close the listen of the song before it. */
  switchTo(track: SongItem | null, now: number): void {
    if (this.track && track && idOf(this.track) === idOf(track)) return;
    this.flush();
    this.track = null;
    if (track) this.start(track, now);
  }

  /** The app is closing: save what there is. */
  flush(): void {
    this.saveListen();
    // A song that never reported a position would overwrite where it was left with 0.
    if (this.track && this.ticked) this.sink.recordPosition(this.track, this.position, this.duration);
  }

  private start(track: SongItem, now: number): void {
    if (this.track && idOf(this.track) !== idOf(track)) this.flush();
    this.track = track;
    this.listenedMs = 0;
    this.lastTickAt = null;
    this.lastPersistAt = now;
    this.position = 0;
    this.ticked = false;
    this.duration = track.duration ?? 0;
  }

  private saveListen(): void {
    const seconds = this.listenedSeconds();
    if (this.track && seconds >= 1) this.sink.recordListen(this.track, seconds, this.duration);
  }
}
