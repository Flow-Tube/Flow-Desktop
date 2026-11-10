const BREAK_LENGTH_MS = 5 * 60_000;

/**
 * How long Flow has been in use since the last break. A short look away keeps the count; five
 * minutes or more away is the break, and the count starts over.
 */
export class BreakClock {
  private countedMs = 0;
  private shownAtMs: number | null = null;
  private hiddenAtMs: number | null = null;

  onShown(nowMs: number) {
    if (this.shownAtMs !== null) return;
    if (this.hiddenAtMs !== null && nowMs - this.hiddenAtMs >= BREAK_LENGTH_MS) this.countedMs = 0;
    this.hiddenAtMs = null;
    this.shownAtMs = nowMs;
  }

  onHidden(nowMs: number) {
    if (this.shownAtMs === null) return;
    this.countedMs += nowMs - this.shownAtMs;
    this.shownAtMs = null;
    this.hiddenAtMs = nowMs;
  }

  /** Starts the count over from `nowMs`, with Flow in use. */
  restart(nowMs: number) {
    this.countedMs = 0;
    this.hiddenAtMs = null;
    this.shownAtMs = nowMs;
  }

  remainingMs(frequencyMs: number, nowMs: number): number {
    const counted = this.countedMs + (this.shownAtMs !== null ? nowMs - this.shownAtMs : 0);
    return Math.max(frequencyMs - counted, 0);
  }
}
