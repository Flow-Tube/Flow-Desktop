// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nextSeekFeedback, seekRippleClipPath, seekSideAt, type SeekFeedback } from "./seekFeedback";
import { useSeekFeedback } from "./useSeekFeedback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("nextSeekFeedback", () => {
  const showing: SeekFeedback = { id: 4, direction: "forward", seconds: 20, visible: true };

  it("adds a step on the side that is showing", () => {
    expect(nextSeekFeedback(showing, "forward", 10)).toEqual({ id: 5, direction: "forward", seconds: 30, visible: true });
  });

  it("starts over on the other side", () => {
    expect(nextSeekFeedback(showing, "backward", 10)).toMatchObject({ direction: "backward", seconds: 10 });
  });

  it("starts over once the label has hidden, even while its total fades", () => {
    expect(nextSeekFeedback({ ...showing, visible: false }, "forward", 10)).toMatchObject({ seconds: 10, visible: true });
    expect(nextSeekFeedback(null, "forward", 5)).toEqual({ id: 1, direction: "forward", seconds: 5, visible: true });
  });
});

describe("seekSideAt", () => {
  it("splits the player into two 35% sides and a middle", () => {
    expect(seekSideAt(349, 1000)).toBe("backward");
    expect(seekSideAt(500, 1000)).toBeNull();
    expect(seekSideAt(651, 1000)).toBe("forward");
    expect(seekSideAt(10, 0)).toBeNull();
  });
});

describe("seekRippleClipPath", () => {
  const circle = (path: string | undefined) => {
    const match = /circle\(([\d.]+)px at (-?[\d.]+)px 50%\)/.exec(path ?? "");
    return { radius: Number(match?.[1]), centerX: Number(match?.[2]) };
  };

  it("covers both corners on the player's edge and reaches the zone's inner edge in the middle", () => {
    const width = 350;
    const height = 600;
    const forward = circle(seekRippleClipPath(width, height, "forward"));
    expect(forward.centerX - forward.radius).toBeCloseTo(0);
    expect(Math.hypot(width - forward.centerX, height / 2)).toBeLessThanOrEqual(forward.radius + 1e-6);

    const backward = circle(seekRippleClipPath(width, height, "backward"));
    expect(backward.centerX + backward.radius).toBeCloseTo(width);
    expect(Math.hypot(backward.centerX, height / 2)).toBeLessThanOrEqual(backward.radius + 1e-6);
  });

  it("draws nothing before the player has a size", () => {
    expect(seekRippleClipPath(0, 600, "forward")).toBeUndefined();
  });
});

describe("useSeekFeedback", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useSeekFeedback>;

  function Probe() {
    latest = useSeekFeedback();
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    root = createRoot(host);
    act(() => root.render(createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("adds up steps, hides 800 ms after the last one and forgets the total 400 ms later", () => {
    act(() => latest.show("forward", 10));
    act(() => {
      vi.advanceTimersByTime(700);
      latest.show("forward", 10);
    });
    expect(latest.feedback).toMatchObject({ seconds: 20, visible: true });

    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(latest.feedback?.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest.feedback).toMatchObject({ seconds: 20, visible: false });

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(latest.feedback).toBeNull();
  });
});
