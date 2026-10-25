import type { LyricsEntry } from "../types";
import type { LyricsListItem } from "./model";
import type { LyricsPanelState } from "./panelState";
import type { RowTarget } from "./rowMotion";
import { staggerFor } from "./rowMotion";
import { ACTIVE_SCALE, INACTIVE_SCALE, INDICATOR_HEIGHT, type RowLayout } from "./rowLayout";
import { indicatorVisible } from "./indicator";
import type { LyricsRowMetrics } from "./scrollMath";

/** The pieces of Android's InlineLyricsPanel and LyricsLine that decide where rows go and how they look. */

export const ROW_METRICS: LyricsRowMetrics = { lineHeightPx: 68, indicatorHeightPx: 72, constraintLineHeightPx: 120, gapPx: 16 };
const RENDER_PADDING = 420;
const RENDER_ROWS = 14;
const FOCUSED_ALPHA = 0.45;
const ALPHA_BY_DISTANCE = [FOCUSED_ALPHA, 0.4, 0.35, 0.3];
const MAX_BLUR_DISTANCE = 4;
const BLUR_PER_LINE = 4;

/** The list row the panel anchors on: the displayed line, or the break that follows it. */
export function activeListIndexOf(items: LyricsListItem[], displayedLine: number): number {
  const index = items.findIndex(
    (item) =>
      (item.kind === "line" && item.index === displayedLine) || (item.kind === "indicator" && item.afterLineIndex === displayedLine),
  );
  return Math.max(0, index);
}

/**
 * Which background lines and instrumental breaks are showing at `position`, as a key that changes
 * only when one of them does. A background vocal shows with its main line, or between them.
 */
export function presenceAt(items: LyricsListItem[], lines: LyricsEntry[], state: LyricsPanelState, position: number): string {
  let key = "";
  items.forEach((item, listIndex) => {
    if (item.kind === "indicator") {
      if (indicatorVisible(state.isAutoScrollEnabled, position, item.gapStartMs, item.gapEndMs)) key += `${listIndex},`;
      return;
    }
    if (!item.entry.isBackground) return;
    let paired = -1;
    for (let j = item.index - 1; j >= 0; j--) {
      if (!lines[j]!.isBackground) {
        paired = j;
        break;
      }
    }
    const inGapWithMain = paired !== -1 && position >= lines[paired]!.time && position <= item.entry.time;
    if (state.activeLineIndices.has(paired) || state.activeLineIndices.has(item.index) || inGapWithMain) key += `${listIndex},`;
  });
  return key;
}

export const presenceSet = (key: string): Set<number> => new Set(key.split(",").filter(Boolean).map(Number));

/**
 * Each row's height now. A background line takes room only while it shows (and fades out); a break
 * grows with its indicator, `shown` from 0 to 1.
 */
export function rowHeights(
  items: LyricsListItem[],
  layouts: RowLayout[],
  shown: (listIndex: number) => number,
  out: number[] = [],
): number[] {
  out.length = items.length;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const layout = layouts[i];
    if (!layout) out[i] = ROW_METRICS.lineHeightPx;
    else if (item.kind === "indicator") out[i] = INDICATOR_HEIGHT * shown(i);
    else if (layout.kind === "line" && item.entry.isBackground) out[i] = shown(i) > 0 ? layout.height : layout.paddingTop + layout.paddingBottom;
    else out[i] = layout.height;
  }
  return out;
}

export interface TargetContext {
  items: LyricsListItem[];
  offsets: Map<number, number>;
  activeListIndex: number;
  anchorY: number;
  state: LyricsPanelState;
  presence: Set<number>;
  isSynced: boolean;
  /** False while the host keeps the panel hidden: no line is sung on screen. */
  active: boolean;
}

export const isLineActive = (ctx: Pick<TargetContext, "state" | "active">, lineIndex: number): boolean =>
  ctx.state.activeLineIndices.has(lineIndex) && ctx.active;

export const rowOffset = (ctx: Pick<TargetContext, "offsets" | "activeListIndex" | "anchorY">, listIndex: number): number =>
  ctx.anchorY + (ctx.offsets.get(listIndex) ?? (listIndex - ctx.activeListIndex) * ROW_METRICS.lineHeightPx);

export function rowTarget(ctx: TargetContext, listIndex: number): RowTarget {
  const item = ctx.items[listIndex]!;
  const offset = rowOffset(ctx, listIndex);
  const staggerMs = staggerFor(Math.abs(listIndex - ctx.activeListIndex));
  if (item.kind === "indicator") {
    return { offset, staggerMs, scale: 1, alpha: 1, blurRadius: 0, active: false, presence: ctx.presence.has(listIndex) };
  }
  const { state } = ctx;
  const isBackground = !!item.entry.isBackground;
  const isActive = isLineActive(ctx, item.index);
  const distance = Math.abs(item.index - state.deferredCurrentLineIndex);
  const alpha =
    !ctx.isSynced || isBackground || isActive
      ? 1
      : state.isAutoScrollEnabled && state.deferredCurrentLineIndex >= 0
        ? ALPHA_BY_DISTANCE[distance] ?? FOCUSED_ALPHA
        : FOCUSED_ALPHA;
  return {
    offset,
    staggerMs,
    scale: isActive ? ACTIVE_SCALE : INACTIVE_SCALE,
    alpha,
    blurRadius: !ctx.isSynced || isActive || isBackground ? 0 : Math.min(distance, MAX_BLUR_DISTANCE) * BLUR_PER_LINE,
    active: isActive,
    presence: !isBackground || ctx.presence.has(listIndex),
  };
}

/** The rows that exist: those within 420 px of the viewport, and always the fourteen either side of the line. */
export function renderedRows(
  ctx: Pick<TargetContext, "items" | "offsets" | "activeListIndex" | "anchorY">,
  manualOffset: number,
  viewportHeight: number,
): number[] {
  const rows: number[] = [];
  for (let listIndex = 0; listIndex < ctx.items.length; listIndex++) {
    const y = rowOffset(ctx, listIndex) + manualOffset;
    if ((y > -RENDER_PADDING && y < viewportHeight + RENDER_PADDING) || Math.abs(listIndex - ctx.activeListIndex) <= RENDER_ROWS) {
      rows.push(listIndex);
    }
  }
  return rows;
}
