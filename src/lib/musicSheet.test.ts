import { MotionGlobalConfig } from "framer-motion";
import { afterEach, describe, expect, it } from "vitest";

import {
  contentOpacity,
  contentScale,
  dockOpacity,
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
  it("hands the dock over to the player in the first quarter", () => {
    expect(dockOpacity(0)).toBe(1);
    expect(dockOpacity(0.125)).toBe(0.5);
    expect(dockOpacity(0.25)).toBe(0);
    expect(sheetOpacity(0.125)).toBe(0.5);
    expect(sheetOpacity(0.5)).toBe(1);
  });

  it("brings the content in once the sheet has cleared the dock", () => {
    expect(contentOpacity(0.15)).toBe(0);
    expect(contentOpacity(0.275)).toBeCloseTo(0.5);
    expect(contentOpacity(0.4)).toBe(1);
    expect(contentScale(0)).toBeCloseTo(0.92);
    expect(contentScale(1)).toBe(1);
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
