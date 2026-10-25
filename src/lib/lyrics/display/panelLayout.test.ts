import { afterEach, describe, expect, it, vi } from "vitest";

import type { LyricsEntry } from "../types";
import { buildMergedLyricsList } from "./model";
import { LyricsPanelState } from "./panelState";
import { activeListIndexOf, presenceAt, presenceSet, renderedRows, rowTarget, type TargetContext } from "./panelLayout";
import { LyricsScroller } from "./scroller";
import { RowMotion, cssBlurOf, staggerFor } from "./rowMotion";

const lines: LyricsEntry[] = [
  { time: 0, text: "" },
  ...Array.from({ length: 8 }, (_, i) => ({ time: 1000 + i * 3000, text: `line ${i}` })),
];

function context(state: LyricsPanelState, overrides: Partial<TargetContext> = {}): TargetContext {
  const items = buildMergedLyricsList(lines);
  return {
    items,
    offsets: new Map(items.map((_, i) => [i, i * 80])),
    activeListIndex: activeListIndexOf(items, state.deferredCurrentLineIndex),
    anchorY: 300,
    state,
    presence: new Set(),
    isSynced: true,
    active: true,
    ...overrides,
  };
}

describe("lyrics panel layout", () => {
  it("dresses the sung line large and sharp, and its neighbours smaller, fainter and blurred by distance", () => {
    const state = new LyricsPanelState(0);
    state.advance(lines, 7200, false);
    const ctx = context(state);
    const sung = rowTarget(ctx, activeListIndexOf(ctx.items, 3));
    expect(sung).toMatchObject({ scale: 1.05, alpha: 1, blurRadius: 0, active: true });
    const next = rowTarget(ctx, activeListIndexOf(ctx.items, 4));
    expect(next).toMatchObject({ scale: 0.92, alpha: 0.4, blurRadius: 4, active: false });
    const far = rowTarget(ctx, activeListIndexOf(ctx.items, 8));
    expect(far).toMatchObject({ alpha: 0.45, blurRadius: 16 });
  });

  it("keeps unsynced lyrics plain: full strength, no blur", () => {
    const state = new LyricsPanelState(0);
    const target = rowTarget(context(state, { isSynced: false }), 4);
    expect(target).toMatchObject({ alpha: 1, blurRadius: 0, scale: 0.92 });
  });

  it("sings no line while the host keeps the panel hidden", () => {
    const state = new LyricsPanelState(0);
    state.advance(lines, 7200, false);
    const ctx = context(state, { active: false });
    expect(rowTarget(ctx, activeListIndexOf(ctx.items, 3)).active).toBe(false);
  });

  it("staggers rows by 20 ms each, at most 200 ms", () => {
    const state = new LyricsPanelState(0);
    const ctx = context(state);
    expect(rowTarget(ctx, ctx.activeListIndex + 2).staggerMs).toBe(40);
    expect(rowTarget(ctx, ctx.activeListIndex + 7).staggerMs).toBe(140);
    expect(staggerFor(50)).toBe(200);
  });

  it("renders the rows near the viewport and the fourteen either side of the line", () => {
    const many: LyricsEntry[] = Array.from({ length: 60 }, (_, i) => ({ time: 1000 + i * 3000, text: `l${i}` }));
    const items = buildMergedLyricsList(many);
    const state = new LyricsPanelState(0);
    const rows = renderedRows({ items, offsets: new Map(items.map((_, i) => [i, i * 100])), activeListIndex: 0, anchorY: 0 }, 0, 500);
    expect(rows[0]).toBe(0);
    expect(rows[rows.length - 1]).toBe(14);
    expect(state.userManualOffset).toBe(0);
  });

  it("shows a background vocal with its main line and an instrumental break while it lasts", () => {
    const withBreak: LyricsEntry[] = [
      { time: 0, text: "" },
      { time: 1000, text: "main", words: [{ text: "main", startTime: 1000, endTime: 2000 }] },
      { time: 1500, text: "(echo)", isBackground: true, words: [{ text: "(echo)", startTime: 1500, endTime: 2500 }] },
      { time: 12000, text: "after", words: [{ text: "after", startTime: 12000, endTime: 13000 }] },
    ];
    const items = buildMergedLyricsList(withBreak);
    const state = new LyricsPanelState(0);
    state.advance(withBreak, 1200, true);
    const echo = items.findIndex((item) => item.kind === "line" && item.entry.isBackground);
    const gap = items.findIndex((item) => item.kind === "indicator");
    expect(presenceSet(presenceAt(items, withBreak, state, 1200)).has(echo)).toBe(true);
    state.advance(withBreak, 6000, true);
    const later = presenceSet(presenceAt(items, withBreak, state, 6000));
    expect(later.has(echo)).toBe(false);
    expect(later.has(gap)).toBe(true);
    expect(presenceSet(presenceAt(items, withBreak, state, 11500)).has(gap)).toBe(false);
  });
});

describe("lyrics scroller", () => {
  afterEach(() => vi.useRealTimers());

  it("clamps a wheel scroll and follows the song again eight seconds after the last one", () => {
    vi.useFakeTimers();
    const state = new LyricsPanelState(0);
    const changes: boolean[] = [];
    const scroller = new LyricsScroller(state, (mode) => changes.push(mode));
    scroller.setBounds(-200, 100);
    scroller.wheel(500);
    expect(state.userManualOffset).toBe(-200);
    expect(state.isAutoScrollEnabled).toBe(false);
    vi.advanceTimersByTime(7000);
    scroller.wheel(-50);
    vi.advanceTimersByTime(7000);
    expect(state.isAutoScrollEnabled).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(state.isAutoScrollEnabled).toBe(true);
    expect(changes[0]).toBe(true);
  });

  it("eases the offset home once auto scroll is back", () => {
    const state = new LyricsPanelState(0);
    const scroller = new LyricsScroller(state, () => {});
    scroller.setBounds(-1000, 1000);
    scroller.wheel(400);
    state.resumeAutoScroll();
    scroller.settleHome();
    let frames = 0;
    while (scroller.step(16) && frames < 100) frames++;
    expect(state.userManualOffset).toBe(0);
    expect(frames * 16).toBeGreaterThanOrEqual(80);
    expect(frames * 16).toBeLessThanOrEqual(600);
  });

  it("flings a drag and stops at the bounds, and a drag is not a tap", () => {
    const state = new LyricsPanelState(0);
    const scroller = new LyricsScroller(state, () => {});
    scroller.setBounds(-300, 300);
    scroller.pointerDown(1, 100, 0);
    for (let t = 10; t <= 60; t += 10) scroller.pointerMove(1, 100 + t * 2, t);
    scroller.pointerUp(1, 60);
    let frames = 0;
    while (scroller.step(16) && frames < 500) frames++;
    expect(state.userManualOffset).toBe(300);
    expect(scroller.consumeDragClick()).toBe(true);
    expect(scroller.consumeDragClick()).toBe(false);
  });
});

describe("row motion", () => {
  it("writes the springs to the element's transform, opacity and Skia-matched blur", () => {
    const element = { style: {} as Record<string, string> } as unknown as HTMLElement;
    const target = { offset: 120, staggerMs: 0, scale: 0.92, alpha: 0.4, blurRadius: 4, active: false, presence: true };
    const motion = new RowMotion(target, "line");
    motion.attach(element);
    motion.write(-20);
    expect(element.style.transform).toBe("translate3d(0,100px,0) scale(0.92)");
    expect(element.style.opacity).toBe("0.4");
    expect(element.style.filter).toBe(`blur(${cssBlurOf(4).toFixed(2)}px)`);
    motion.update({ ...target, active: true, alpha: 1, blurRadius: 0, scale: 1.05 }, { autoScroll: true, snap: true, blur: true });
    motion.write(0);
    expect(element.style.opacity).toBe("1");
    expect(element.style.filter).toBe("none");
  });

  it("never blurs where blur is off", () => {
    const element = { style: {} as Record<string, string> } as unknown as HTMLElement;
    const target = { offset: 0, staggerMs: 0, scale: 0.92, alpha: 0.4, blurRadius: 0, active: false, presence: true };
    const motion = new RowMotion(target, "line");
    motion.attach(element);
    motion.update({ ...target, blurRadius: 12 }, { autoScroll: true, snap: true, blur: false });
    motion.write(0);
    expect(element.style.filter).toBe("none");
  });
});
