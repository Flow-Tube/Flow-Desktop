import type { ViewFormat } from "../api/recap";

/** At or past this share of a video, a session counts as a view. */
export const WATCHED_FRACTION = 0.2;
/** Below the share, a session that ran this far is a real abandonment; a shorter bounce says nothing. */
const MIN_SKIP_POSITION_MS = 10_000;
/** A live stream has no length to grade against; this much watching makes it a view. */
const LIVE_VIEW_MS = 60_000;
/** Longest gap between two reports that still counts as continuous watching. */
const MAX_WATCH_STEP_MS = 30_000;
const SEND_INTERVAL_MS = 5_000;

/**
 * Real time spent between two reports: the wall clock, but never more than the position advanced.
 * A seek forward adds only the elapsed time, a pause adds nothing, and faster playback counts the
 * minutes the viewer really spent.
 */
export function watchedStep(wallDeltaMs: number, positionDeltaMs: number): number {
  const wall = Math.min(Math.max(wallDeltaMs, 0), MAX_WATCH_STEP_MS);
  return Math.min(wall, Math.max(positionDeltaMs, 0));
}

export interface ViewStretch {
  watchedMs: number;
  counted: boolean;
  skipped: boolean;
  continued: boolean;
}

/**
 * One viewing of one video, sending the ledger what it has not sent yet: time every so often, the
 * view once when it first counts, and the skip once when it closes without having counted.
 */
export class RecapViewSession {
  private watchedMs = 0;
  private sentMs = 0;
  private maxPositionMs = 0;
  private durationMs = 0;
  private lastPositionMs: number | null = null;
  private lastWallMs = 0;
  private lastSentAt = 0;
  private viewSent = false;
  private skipSent = false;
  private anythingSent = false;

  constructor(
    private readonly format: () => ViewFormat,
    private readonly send: (stretch: ViewStretch) => void,
    private readonly countFraction = WATCHED_FRACTION,
  ) {}

  tick(positionMs: number, durationMs: number, nowMs: number) {
    if (durationMs > 0) this.durationMs = durationMs;
    this.maxPositionMs = Math.max(this.maxPositionMs, positionMs);
    if (this.lastPositionMs === null) {
      this.lastSentAt = nowMs;
    } else {
      this.watchedMs += watchedStep(nowMs - this.lastWallMs, positionMs - this.lastPositionMs);
    }
    this.lastPositionMs = positionMs;
    this.lastWallMs = nowMs;
    if (nowMs - this.lastSentAt >= SEND_INTERVAL_MS) {
      this.lastSentAt = nowMs;
      this.flush(false);
    }
  }

  close() {
    this.flush(true);
  }

  private countsAsView(): boolean {
    if (this.format() === "LIVE") return this.watchedMs >= LIVE_VIEW_MS;
    return this.durationMs > 0 && this.maxPositionMs / this.durationMs >= this.countFraction;
  }

  private flush(final: boolean) {
    // The ledger takes whole milliseconds and positions are fractional; what rounds away goes next time.
    const unsentMs = Math.round(this.watchedMs - this.sentMs);
    const counted = !this.viewSent && this.countsAsView();
    const skipped =
      final &&
      !counted &&
      !this.viewSent &&
      !this.skipSent &&
      this.format() !== "LIVE" &&
      this.durationMs > 0 &&
      this.maxPositionMs >= MIN_SKIP_POSITION_MS;
    if (!counted && !skipped && unsentMs <= 0) return;
    this.send({ watchedMs: unsentMs, counted, skipped, continued: this.anythingSent });
    this.anythingSent = true;
    this.sentMs += unsentMs;
    if (counted) this.viewSent = true;
    if (skipped) this.skipSent = true;
  }
}
