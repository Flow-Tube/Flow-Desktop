import { describe, expect, it } from "vitest";

import type { LyricsEntry } from "../types";
import { LyricsPanelState, mainLineAt, withMainLinesOfBackground } from "./panelState";
import { findActiveLineIndices, type LyricsListItem } from "./model";
import { lyricsRowOffsets } from "./scrollMath";

const lines: LyricsEntry[] = [
  { time: 0, text: "" },
  { time: 1000, text: "first" },
  { time: 5000, text: "second" },
  { time: 9000, text: "third" },
  { time: 13000, text: "fourth" },
];

const tracking = (position: number) => {
  const state = new LyricsPanelState(position);
  state.startTracking(position);
  return state;
};

describe("lyrics panel state", () => {
  it("makes the sung line active and scrolls to it", () => {
    const state = tracking(0);
    state.advance(lines, 5500, false);
    expect([...state.activeLineIndices]).toEqual([2]);
    expect(state.scrollTargetIndex).toBe(2);
    expect(state.currentPosition).toBe(5500);
  });

  it("retargets the scroll on a seek back of more than two seconds", () => {
    const state = tracking(0);
    state.advance(lines, 9500, false);
    state.advance(lines, 1200, false);
    expect(state.scrollTargetIndex).toBe(1);
    expect(state.deferredCurrentLineIndex).toBe(1);
  });

  it("pauses auto scroll on a user scroll until a jump or resync", () => {
    const state = tracking(0);
    state.onUserScroll(-120, 42);
    expect(state.isAutoScrollEnabled).toBe(false);
    expect(state.lastPreviewTime).toBe(42);
    state.jumpTo(3);
    expect(state.isAutoScrollEnabled).toBe(true);
    expect(state.scrollTargetIndex).toBe(3);
    expect(state.deferredCurrentLineIndex).toBe(3);
  });

  it("resyncs to the line being sung", () => {
    const state = tracking(0);
    state.advance(lines, 9200, false);
    state.onUserScroll(300, 1);
    state.resync(lines);
    expect(state.isAutoScrollEnabled).toBe(true);
    expect(state.deferredCurrentLineIndex).toBe(3);
    expect(state.lastPreviewTime).toBe(0);
  });

  it("keeps the main line active alongside its background vocal", () => {
    const withBackground: LyricsEntry[] = [
      { time: 0, text: "" },
      { time: 1000, text: "main" },
      { time: 1500, text: "(echo)", isBackground: true },
      { time: 4000, text: "next" },
    ];
    const active = withMainLinesOfBackground(withBackground, findActiveLineIndices(withBackground, 1600));
    expect(active.has(1) && active.has(2)).toBe(true);
    expect(mainLineAt(withBackground, 1200)).toBe(1);
    // Only the echo is active here, so the scroll target falls back to it.
    expect(mainLineAt(withBackground, 1600)).toBe(2);
  });

  it("lets a word-synced main line keep its fill while its background vocal starts (LY9)", () => {
    const sung: LyricsEntry[] = [
      { time: 0, text: "" },
      { time: 1000, text: "main line", words: [{ text: "main", startTime: 1000, endTime: 1800 }, { text: "line", startTime: 1800, endTime: 3000 }] },
      { time: 2000, text: "(echo)", isBackground: true, words: [{ text: "(echo)", startTime: 2000, endTime: 2600 }] },
      { time: 5000, text: "next", words: [{ text: "next", startTime: 5000, endTime: 6000 }] },
    ];
    const state = tracking(0);
    state.advance(sung, 2200, true);
    expect(state.activeLineIndices.has(1)).toBe(true);
    expect(state.activeLineIndices.has(2)).toBe(true);
    expect(state.deferredCurrentLineIndex).toBe(1);
  });

  it("counts a change only when the panel has something new to draw", () => {
    const state = tracking(0);
    state.advance(lines, 5500, false);
    const version = state.version;
    state.advance(lines, 5580, false);
    expect(state.version).toBe(version);
    state.advance(lines, 9100, false);
    expect(state.version).toBeGreaterThan(version);
  });

  it("lays rows out from the active row, with gaps only before main lines", () => {
    const items: LyricsListItem[] = [
      { kind: "line", index: 0, entry: { time: 0, text: "a" } },
      { kind: "indicator", afterLineIndex: 0, gapStartMs: 1000, gapEndMs: 9000 },
      { kind: "line", index: 1, entry: { time: 9000, text: "b" } },
    ];
    const metrics = { lineHeightPx: 60, indicatorHeightPx: 72, constraintLineHeightPx: 120, gapPx: 16 };
    const offsets = lyricsRowOffsets(items, [100, 50, 100], 0, metrics);
    expect([...offsets.entries()]).toEqual([
      [0, 0],
      [1, 100],
      [2, 166],
    ]);
  });
});
