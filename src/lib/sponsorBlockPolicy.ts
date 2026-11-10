import type { SponsorBlockSegment } from "./api/foss";
import type { SponsorBlockAction, SponsorBlockCategory } from "../store/useSettingsStore";
import { segmentsToRearm } from "./sponsorBlockRearm";

export const HIGHLIGHT_CATEGORY = "poi_highlight";

/** How long after a video's content begins the jump to its highlight is offered. */
const HIGHLIGHT_BUTTON_WINDOW_SECONDS = 10;
/** A segment this close to the content before it still counts as following straight on. */
const OPENING_SKIP_GAP_SECONDS = 1;

type Actions = Partial<Record<SponsorBlockCategory, SponsorBlockAction>>;

export const isPointSegment = (segment: SponsorBlockSegment) => segment.category === HIGHLIGHT_CATEGORY;

/**
 * The action for a segment. One submitted as a mute (a swear word, a short sound) is muted where the
 * category would skip it, because skipping it would cut the speech around it.
 */
export function segmentAction(segment: SponsorBlockSegment, actions: Actions): SponsorBlockAction {
  const action = actions[segment.category as SponsorBlockCategory] ?? "ignore";
  const skips = action === "skip" || action === "skip_once";
  return skips && segment.actionType === "mute" ? "mute" : action;
}

export function skipsAutomatically(action: SponsorBlockAction, alreadySkippedOnce: boolean): boolean {
  return action === "skip" || (action === "skip_once" && !alreadySkippedOnce);
}

export function showsSkipButton(action: SponsorBlockAction, alreadySkippedOnce: boolean): boolean {
  if (action === "skip_once") return alreadySkippedOnce;
  return action === "skip_button" || action === "notify" || action === "mute";
}

/** The segments the seek bar shows; a disabled category is left out. */
export function seekBarSegments(segments: SponsorBlockSegment[], actions: Actions): SponsorBlockSegment[] {
  return segments.filter((segment) => segmentAction(segment, actions) !== "disabled");
}

/** Where a viewer really starts watching: past any segments skipped automatically from the first second. */
function contentStart(segments: SponsorBlockSegment[], actions: Actions, skippedOnce: ReadonlySet<string>): number {
  let start = 0;
  const ranges = segments.filter(({ segment }) => segment[1] > segment[0]).sort((a, b) => a.segment[0] - b.segment[0]);
  for (const segment of ranges) {
    const skipped = skipsAutomatically(segmentAction(segment, actions), skippedOnce.has(segment.UUID));
    if (skipped && segment.segment[0] <= start + OPENING_SKIP_GAP_SECONDS) start = Math.max(start, segment.segment[1]);
  }
  return start;
}

export interface SponsorBlockTick {
  /** Jump past this segment now. */
  skip: SponsorBlockSegment | null;
  /** The segment holding the sound off at this position. */
  mute: SponsorBlockSegment | null;
  /** A mute that has just begun, counted once in the stats. */
  muteStarted: SponsorBlockSegment | null;
  /** A notify segment that has just begun. */
  notify: SponsorBlockSegment | null;
  /** The segment the Skip or Jump button offers. */
  manual: SponsorBlockSegment | null;
}

/** What has already happened in this video, and what SponsorBlock does at each position. */
export class SponsorBlockTracker {
  private handled = new Set<string>();
  private dismissed = new Set<string>();
  private skippedOnce = new Set<string>();

  /** A new video starts clean. */
  reset(): void {
    this.handled.clear();
    this.dismissed.clear();
    this.skippedOnce.clear();
  }

  /** The viewer used the button on this segment, so it stays out of the way until they rewind past it. */
  dismiss(uuid: string): void {
    this.dismissed.add(uuid);
  }

  tick(position: number, segments: SponsorBlockSegment[], actions: Actions, ended: boolean): SponsorBlockTick {
    const result: SponsorBlockTick = { skip: null, mute: null, muteStarted: null, notify: null, manual: null };
    for (const { UUID } of segmentsToRearm(segments, position)) {
      this.handled.delete(UUID);
      this.dismissed.delete(UUID);
    }
    for (const segment of segments) {
      const [start, end] = segment.segment;
      if (position < start || position >= end) continue;
      const action = segmentAction(segment, actions);
      const first = !this.handled.has(segment.UUID);
      if (first && skipsAutomatically(action, this.skippedOnce.has(segment.UUID))) {
        this.handled.add(segment.UUID);
        if (action === "skip_once") this.skippedOnce.add(segment.UUID);
        return { ...result, skip: segment };
      }
      if (action === "mute" && !this.dismissed.has(segment.UUID)) {
        result.mute = segment;
        if (first) {
          this.handled.add(segment.UUID);
          result.muteStarted = segment;
        }
      } else if (action === "notify" && first) {
        this.handled.add(segment.UUID);
        result.notify = segment;
      }
    }
    result.manual = ended ? null : this.manualSegment(position, segments, actions);
    return result;
  }

  private manualSegment(position: number, segments: SponsorBlockSegment[], actions: Actions): SponsorBlockSegment | null {
    const highlightWindowEnd = contentStart(segments, actions, this.skippedOnce) + HIGHLIGHT_BUTTON_WINDOW_SECONDS;
    for (const segment of segments) {
      const [start, end] = segment.segment;
      const inWindow = isPointSegment(segment)
        ? position < Math.min(highlightWindowEnd, start)
        : position >= start && position < end;
      if (!inWindow || this.dismissed.has(segment.UUID)) continue;
      if (showsSkipButton(segmentAction(segment, actions), this.skippedOnce.has(segment.UUID))) return segment;
    }
    return null;
  }
}
