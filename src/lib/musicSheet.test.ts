import { MotionGlobalConfig } from "framer-motion";
import { afterEach, describe, expect, it } from "vitest";

import {
  clampPull,
  collapseSquash,
  contentOpacity,
  contentRise,
  dockOpacity,
  dockRise,
  openDragTarget,
  pullOpacity,
  shouldClosePulled,
  holdSheet,
  settleSheet,
  sheetClip,
  sheetOpacity,
  sheetProgress,
  sheetTarget,
} from "./musicSheet";

describe("sheetTarget", () => {
  it("follows a fling either way", () => {
    expect(sheetTarget(0.1, 400)).toBe(1);
    expect(sheetTarget(0.9, -400)).toBe(0);
  });

  it("settles a slow release at the nearer end", () => {
    expect(sheetTarget(0.6, 50)).toBe(1);
    expect(sheetTarget(0.4, -50)).toBe(0);
  });
});

describe("sheet fades", () => {
  it("fades the mini player out by halfway, as Android does", () => {
    expect(dockOpacity(0)).toBe(1);
    expect(dockOpacity(0.25)).toBe(0.5);
    expect(dockOpacity(0.5)).toBe(0);
    expect(sheetOpacity(0.125)).toBe(0.5);
    expect(sheetOpacity(0.5)).toBe(1);
  });

  it("brings the content in from a quarter of the way, rising 24 px", () => {
    expect(contentOpacity(0.25)).toBe(0);
    expect(contentOpacity(0.625)).toBeCloseTo(0.5);
    expect(contentOpacity(1)).toBe(1);
    expect(contentRise(0)).toBe(24);
    expect(contentRise(1)).toBe(0);
  });

  it("lifts the mini player with the card's top edge", () => {
    expect(dockRise(0, 600)).toBe(-0);
    expect(dockRise(0.5, 600)).toBe(-300);
    expect(dockRise(2, 600)).toBe(-600);
  });
});

describe("sheetClip", () => {
  const sheet = { top: 40, right: 1200, bottom: 800, left: 0 };
  const dock = { top: 712, right: 1140, bottom: 776, left: 60 };

  it("starts at the dock's rectangle", () => {
    expect(sheetClip(0, dock, sheet)).toBe("inset(672px 60px 24px 60px round 16px)");
  });

  it("is halfway there halfway through", () => {
    expect(sheetClip(0.5, dock, sheet)).toBe("inset(336px 30px 12px 30px round 8px)");
  });

  it("clips nothing once open", () => {
    expect(sheetClip(1, dock, sheet)).toBe("none");
  });

  it("rises from the bottom edge without a dock", () => {
    expect(sheetClip(0, null, sheet)).toBe("inset(760px 0px 0px 0px round 16px)");
  });
});

describe("settleSheet", () => {
  afterEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    sheetProgress.jump(0);
  });

  it("lands exactly on its end, even when the animation is skipped", async () => {
    MotionGlobalConfig.skipAnimations = true;
    sheetProgress.jump(0.97);
    await expect(settleSheet(0)).resolves.toBe(true);
    expect(sheetProgress.get()).toBe(0);
  });

  it("gives way to a drag that takes the sheet by hand", async () => {
    MotionGlobalConfig.skipAnimations = true;
    sheetProgress.jump(0.4);
    const settling = settleSheet(0);
    holdSheet();
    sheetProgress.set(0.6);
    await expect(settling).resolves.toBe(false);
    expect(sheetProgress.get()).toBe(0.6);
  });
});

describe("closing the mini player by pulling it down", () => {
  const height = 64;

  it("can be pulled at most one and a half heights", () => {
    expect(clampPull(500, height)).toBe(96);
    expect(clampPull(-20, height)).toBe(0);
  });

  it("closes past half its height or on a flick down", () => {
    expect(shouldClosePulled(33, height, 0)).toBe(true);
    expect(shouldClosePulled(20, height, 0)).toBe(false);
    expect(shouldClosePulled(10, height, 400)).toBe(true);
    expect(shouldClosePulled(0, height, 400)).toBe(false);
  });

  it("is gone by 0.6 of its height", () => {
    expect(pullOpacity(0, height)).toBe(1);
    expect(pullOpacity(height * 0.3, height)).toBeCloseTo(0.5);
    expect(pullOpacity(height * 0.6, height)).toBe(0);
  });
});

describe("dragging the open player", () => {
  it("stays open on a move up", () => {
    expect(openDragTarget(0.9, -40, 0)).toBe(1);
  });

  it("collapses on any move down past 5 px", () => {
    expect(openDragTarget(0.95, 6, 0)).toBe(0);
  });

  it("goes with a fling, then to the nearer end", () => {
    expect(openDragTarget(0.98, 2, 200)).toBe(0);
    expect(openDragTarget(0.98, 2, 0)).toBe(1);
    expect(openDragTarget(0.3, 2, 0)).toBe(0);
  });

  it("lands more squashed the further it was open", () => {
    expect(collapseSquash(0)).toBe(1);
    expect(collapseSquash(1)).toBeCloseTo(0.97);
  });
});
