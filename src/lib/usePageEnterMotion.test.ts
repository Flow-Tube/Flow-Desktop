import { describe, expect, it } from "vitest";
import { PAGE_RISE_PX, pageEnterKeyframes } from "./usePageEnterMotion";

describe("pageEnterKeyframes", () => {
  it("rises and fades for ordinary pages", () => {
    expect(pageEnterKeyframes(true)).toEqual([
      { opacity: 0, transform: `translateY(${PAGE_RISE_PX}px)` },
      { opacity: 1, transform: "none" },
    ]);
  });

  it("only fades when the page must not move", () => {
    const frames = pageEnterKeyframes(false);
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(frames.some((frame) => "transform" in frame)).toBe(false);
  });
});
