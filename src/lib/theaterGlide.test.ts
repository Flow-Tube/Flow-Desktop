import { describe, expect, it } from "vitest";
import { frameKeyframes, isGlideTooSlow, meanFrameInterval } from "./theaterGlide";

const small = { top: 80, left: 24, width: 960, height: 540 };
const wide = { top: 56, left: 0, width: 1600, height: 760 };

describe("frameKeyframes", () => {
  it("squares the corners going into theater mode", () => {
    const [from, to] = frameKeyframes(small, wide, true);
    expect(from).toMatchObject({ transform: "translate3d(24px, 80px, 0)", width: "960px", height: "540px", borderRadius: "12px" });
    expect(to).toMatchObject({ transform: "translate3d(0px, 56px, 0)", width: "1600px", height: "760px", borderRadius: "0px" });
  });

  it("rounds them again on the way back", () => {
    const [from, to] = frameKeyframes(wide, small, false);
    expect(from?.borderRadius).toBe("0px");
    expect(to?.borderRadius).toBe("12px");
  });
});

describe("frame timing", () => {
  it("needs a few frames before it judges", () => {
    expect(meanFrameInterval([0, 16])).toBeNull();
    expect(isGlideTooSlow([0, 40])).toBe(false);
  });

  it("keeps the glide at 60 fps and drops it below 40", () => {
    expect(isGlideTooSlow([0, 16.7, 33.4, 50.1, 66.8])).toBe(false);
    expect(isGlideTooSlow([0, 30, 60, 90, 120])).toBe(true);
  });
});
