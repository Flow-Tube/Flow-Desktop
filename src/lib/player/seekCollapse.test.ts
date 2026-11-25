import { describe, expect, it } from "vitest";

import { collapsedSeekTransform } from "./seekCollapse";

describe("collapsedSeekTransform", () => {
  // A 1280x720 player with 20 px of padding each side and the 24 px track 64 px above the bottom.
  const box = { layerWidth: 1280, layerHeight: 720, trackLeft: 20, trackTop: 632, trackWidth: 1240, trackHeight: 24 };

  it("stretches the track to the player's width", () => {
    expect(collapsedSeekTransform(box)?.scaleX).toBeCloseTo(1280 / 1240);
    expect(collapsedSeekTransform(box)?.x).toBe(0);
  });

  it("puts the thinned bar's bottom on the player's bottom edge", () => {
    const transform = collapsedSeekTransform(box)!;
    const centreAfter = box.trackTop + box.trackHeight / 2 + transform.y;
    expect(centreAfter + (5 * transform.scaleY) / 2).toBe(720);
    expect(transform.scaleY).toBeCloseTo(0.6);
  });

  it("centres a track that sits off centre", () => {
    expect(collapsedSeekTransform({ ...box, trackLeft: 32, trackWidth: 1216 })?.x).toBe(0);
    expect(collapsedSeekTransform({ ...box, trackLeft: 40, trackWidth: 1220 })?.x).toBe(-10);
  });

  it("gives nothing for a layer or track with no size yet", () => {
    expect(collapsedSeekTransform({ ...box, trackWidth: 0 })).toBeNull();
    expect(collapsedSeekTransform({ ...box, layerHeight: 0 })).toBeNull();
  });
});
