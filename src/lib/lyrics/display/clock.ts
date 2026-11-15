import { musicAudioEngine } from "../../audio/musicAudioEngine";

// A jump this large is a seek, not a correction of the estimate.
const SEEK_MS = 500;
// How much faster or slower than the song the clock may run while it works off a correction.
const MAX_CORRECTION = 0.5;

/**
 * The song position the lyrics follow, read from the playing audio element and carried forward at
 * the playback speed by the time since it last changed: the element's clock moves in coarse steps,
 * the lyrics must not. Port of Android's LyricsFillClock on top: while playing it only moves
 * forward, working a correction off by running a little slower or faster, so a word's fill never
 * snaps back; a jump of half a second or more is a seek and is taken at once.
 */
export class LyricsClock {
  private lastPosition = Number.NaN;
  private lastUpdate = 0;
  private shown = Number.NaN;
  private lastRead = 0;

  /** The position in ms at `nowMs` (a `performance.now()` time), without the sync offset. */
  read(nowMs: number, playing: boolean): number {
    const position = musicAudioEngine.getCurrentTime() * 1000;
    if (position !== this.lastPosition) {
      this.lastPosition = position;
      this.lastUpdate = nowMs;
    }
    if (!playing) {
      this.shown = Number.NaN;
      return this.lastPosition;
    }
    const speed = musicAudioEngine.getSpeed();
    const estimate = this.lastPosition + (nowMs - this.lastUpdate) * speed;
    const elapsed = Math.max(0, nowMs - this.lastRead) * speed;
    this.lastRead = nowMs;
    const predicted = this.shown + elapsed;
    const error = estimate - predicted;
    this.shown =
      Number.isNaN(this.shown) || Math.abs(error) >= SEEK_MS
        ? estimate
        : predicted + Math.min(elapsed * MAX_CORRECTION, Math.max(-elapsed * MAX_CORRECTION, error));
    return this.shown;
  }

  durationMs(): number {
    return musicAudioEngine.getDuration() * 1000;
  }
}

type FrameStep = (dtMs: number, nowMs: number) => boolean;

/** Runs frame callbacks only while one of them still has something to move. */
export class FrameLoop {
  // A plain array, so the frame loop walks it without allocating an iterator.
  private steps: FrameStep[] = [];
  private raf: number | null = null;
  private last = 0;
  private enabled = true;

  add(step: FrameStep): () => void {
    this.steps = [...this.steps, step];
    this.wake();
    return () => {
      this.steps = this.steps.filter((s) => s !== step);
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.wake();
    else this.stop();
  }

  wake(): void {
    if (!this.enabled || this.raf !== null) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private readonly frame = (now: number) => {
    this.raf = null;
    const dt = Math.max(0, now - this.last);
    this.last = now;
    let moving = false;
    const steps = this.steps;
    for (let i = 0; i < steps.length; i++) if (steps[i]!(dt, now)) moving = true;
    if (moving && this.enabled) this.raf = requestAnimationFrame(this.frame);
  };
}
