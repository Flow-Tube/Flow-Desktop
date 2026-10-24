import type { LyricsEntry } from "../types";
import { findActiveLineIndices } from "./model";

const isMain = (lines: LyricsEntry[], i: number): boolean => !!lines[i] && !lines[i]!.isBackground;

/** The last main (not background) line active at `position`, else the last active line. */
export function mainLineAt(lines: LyricsEntry[], position: number): number | null {
  const active = [...findActiveLineIndices(lines, position)];
  const main = active.filter((i) => isMain(lines, i));
  if (main.length > 0) return Math.max(...main);
  return active.length > 0 ? Math.max(...active) : null;
}

/** A background vocal line keeps the main line it belongs to active alongside it. */
export function withMainLinesOfBackground(lines: LyricsEntry[], indices: Set<number>): Set<number> {
  const result = new Set(indices);
  for (const i of indices) {
    if (!lines[i]?.isBackground) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (isMain(lines, j)) {
        result.add(j);
        break;
      }
    }
  }
  return result;
}

const sameSet = (a: Set<number>, b: Set<number>): boolean => a.size === b.size && [...a].every((v) => b.has(v));

/**
 * Which lines are sung and which line the panel scrolls to. `advance` runs once per sync tick with
 * the offset-adjusted position. Port of Android's LyricsPanelState; `version` counts the changes a
 * renderer has to react to, so it can skip a tick that changed nothing it draws.
 */
export class LyricsPanelState {
  activeLineIndices = new Set<number>();
  scrollTargetIndex = -1;
  currentPosition: number;
  deferredCurrentLineIndex = 0;
  lastPreviewTime = 0;
  isAutoScrollEnabled = true;
  userManualOffset = 0;
  version = 0;

  private previousScrollActiveIndices = new Set<number>();
  private lastMainMaxSeen = -1;
  private previousPosition: number;

  constructor(initialPosition: number) {
    this.currentPosition = initialPosition;
    this.previousPosition = initialPosition;
  }

  reset(): void {
    this.activeLineIndices = new Set();
    this.previousScrollActiveIndices = new Set();
    this.scrollTargetIndex = -1;
    this.deferredCurrentLineIndex = 0;
    this.isAutoScrollEnabled = true;
    this.userManualOffset = 0;
    this.lastMainMaxSeen = -1;
    this.version++;
  }

  startTracking(position: number): void {
    this.previousPosition = position;
  }

  /** A tap on a synced line: follow that line from now on. */
  jumpTo(index: number): void {
    this.scrollTargetIndex = index;
    this.deferredCurrentLineIndex = index;
    this.lastMainMaxSeen = index;
    this.isAutoScrollEnabled = true;
    this.lastPreviewTime = 0;
    this.version++;
  }

  onUserScroll(offset: number, nowMs: number): void {
    this.userManualOffset = offset;
    if (this.isAutoScrollEnabled) this.version++;
    this.isAutoScrollEnabled = false;
    this.lastPreviewTime = nowMs;
  }

  advance(lines: LyricsEntry[], position: number, hasWordTimings: boolean): void {
    const before = { target: this.scrollTargetIndex, deferred: this.deferredCurrentLineIndex, active: this.activeLineIndices };
    if (this.previousPosition - position > 2000 && this.isAutoScrollEnabled) {
      const seekTarget = mainLineAt(lines, position) ?? 0;
      this.scrollTargetIndex = seekTarget;
      this.lastMainMaxSeen = seekTarget;
      this.deferredCurrentLineIndex = seekTarget;
    }
    this.previousPosition = position;
    this.currentPosition = position;

    const initialActive = findActiveLineIndices(lines, position);
    const scrollActiveRaw = findActiveLineIndices(lines, position + (hasWordTimings ? 0 : 250));
    const scrollActive = withMainLinesOfBackground(lines, scrollActiveRaw);
    const newActive = withMainLinesOfBackground(lines, initialActive);

    const mainScroll = [...scrollActive].filter((i) => isMain(lines, i));
    const scrollMax =
      mainScroll.length > 0 ? Math.max(...mainScroll) : scrollActive.size > 0 ? Math.max(...scrollActive) : -1;
    const targetOutsideActive = !scrollActive.has(this.scrollTargetIndex);

    const shouldScroll =
      (targetOutsideActive && scrollActive.size > 0 && scrollMax > this.scrollTargetIndex) ||
      (targetOutsideActive && scrollActive.size === 0 && this.previousScrollActiveIndices.size > 0) ||
      (this.scrollTargetIndex === -1 && scrollActive.size > 0) ||
      (this.previousScrollActiveIndices.size === 0 && scrollActive.size > 0 && scrollMax > this.scrollTargetIndex);

    if (shouldScroll) {
      let targetToScroll = scrollMax;
      if (targetOutsideActive && scrollActive.size === 0) {
        targetToScroll = this.scrollTargetIndex;
        for (let i = this.lastMainMaxSeen + 1; i < lines.length; i++) {
          if (isMain(lines, i)) {
            targetToScroll = i;
            break;
          }
        }
      }
      if (targetToScroll !== -1 && targetToScroll > this.scrollTargetIndex) this.scrollTargetIndex = targetToScroll;
    }

    if (scrollMax > this.lastMainMaxSeen && scrollMax !== -1) this.lastMainMaxSeen = scrollMax;
    this.previousScrollActiveIndices = scrollActive;
    this.activeLineIndices = sameSet(newActive, this.activeLineIndices) ? this.activeLineIndices : newActive;

    // Android's LaunchedEffect: a new scroll target becomes the displayed line while auto-scrolling.
    if (this.scrollTargetIndex !== -1 && this.isAutoScrollEnabled) this.deferredCurrentLineIndex = this.scrollTargetIndex;

    if (
      before.target !== this.scrollTargetIndex ||
      before.deferred !== this.deferredCurrentLineIndex ||
      before.active !== this.activeLineIndices
    ) {
      this.version++;
    }
  }

  /** The preview after a manual scroll ran out: follow the scroll target again. */
  resumeAutoScroll(): void {
    this.lastPreviewTime = 0;
    this.isAutoScrollEnabled = true;
    if (this.scrollTargetIndex !== -1) this.deferredCurrentLineIndex = this.scrollTargetIndex;
    this.version++;
  }

  /** Snaps back to the line being sung now, after the user scrolled away. */
  resync(lines: LyricsEntry[]): void {
    const target = mainLineAt(lines, this.currentPosition) ?? this.scrollTargetIndex;
    if (target !== -1) {
      this.deferredCurrentLineIndex = target;
      this.scrollTargetIndex = target;
      this.lastMainMaxSeen = target;
    }
    this.isAutoScrollEnabled = true;
    this.lastPreviewTime = 0;
    this.version++;
  }
}
