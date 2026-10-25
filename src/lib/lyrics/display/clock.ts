import { musicAudioEngine } from "../../audio/musicAudioEngine";

/**
 * The song position the lyrics follow, read from the playing audio element and carried forward
 * by the time since it last changed, as Android does with its player position: the element's
 * clock moves in coarse steps, the lyrics must not.
 */
export class LyricsClock {
  private lastPosition = Number.NaN;
  private lastUpdate = 0;

  /** The position in ms at `nowMs` (a `performance.now()` time), without the sync offset. */
  read(nowMs: number, playing: boolean): number {
    const position = musicAudioEngine.getCurrentTime() * 1000;
    if (position !== this.lastPosition) {
      this.lastPosition = position;
      this.lastUpdate = nowMs;
    }
    return playing ? this.lastPosition + (nowMs - this.lastUpdate) : this.lastPosition;
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
