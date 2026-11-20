import { describe, expect, it } from "vitest";

import {
  UNZOOMED,
  ZOOM_MAX,
  clampPan,
  fillScale,
  isAtFill,
  panBy,
  visibleVideoRect,
  zoomAbout,
  zoomFrame,
  zoomTransform,
} from "./videoZoom";

// A 16:9 video in a 16:9 frame, and a 4:3 video letterboxed in that frame.
const wide = zoomFrame(1600, 900, 1920, 1080, "fit");
const boxed = zoomFrame(1600, 900, 1440, 1080, "fit");
const centre = { x: 0, y: 0 };

describe("zoomFrame", () => {
  it("places the picture by the Resize choice", () => {
    expect(boxed).toEqual({ width: 1600, height: 900, pictureWidth: 1200, pictureHeight: 900 });
    expect(zoomFrame(1600, 900, 1440, 1080, "zoom").pictureWidth).toBe(1600);
    expect(zoomFrame(1600, 900, 1440, 1080, "fill")).toEqual({ width: 1600, height: 900, pictureWidth: 1600, pictureHeight: 900 });
  });
});

describe("zoomAbout", () => {
  it("keeps the point under the pointer still", () => {
    const pointer = { x: 400, y: -200 };
    const zoomed = zoomAbout(UNZOOMED, 2, pointer, wide);
    expect(zoomed.scale).toBe(2);
    // The content point that was under the pointer is (400, -200); after zooming it maps to x + 2 * 400.
    expect(zoomed.x + 2 * pointer.x).toBeCloseTo(pointer.x);
    expect(zoomed.y + 2 * pointer.y).toBeCloseTo(pointer.y);
  });

  it("stays between 1x and 6x and settles to 1x near it", () => {
    expect(zoomAbout(UNZOOMED, 100, centre, wide).scale).toBe(ZOOM_MAX);
    expect(zoomAbout(UNZOOMED, 0.5, centre, wide)).toEqual(UNZOOMED);
    expect(zoomAbout({ scale: 1.1, x: 10, y: 0 }, 1 / 1.09, centre, wide)).toEqual(UNZOOMED);
  });

  it("locks onto the scale that fills the frame", () => {
    expect(fillScale(boxed)).toBeCloseTo(1600 / 1200);
    const near = zoomAbout(UNZOOMED, 1.35, centre, boxed);
    expect(near.scale).toBe(fillScale(boxed));
    expect(isAtFill(near, boxed)).toBe(true);
    expect(zoomAbout(UNZOOMED, 1.5, centre, boxed).scale).toBe(1.5);
  });

  it("has no fill point when the shapes already match", () => {
    expect(fillScale(wide)).toBeNull();
  });
});

describe("pan", () => {
  it("never shows past the picture's edge", () => {
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(panBy(zoomed, 5000, -5000, wide)).toEqual({ scale: 2, x: 800, y: -450 });
  });

  it("keeps letterbox bars out of view", () => {
    // At 1.2x the 1200 px wide picture is 1440 px, still narrower than the 1600 px frame.
    expect(clampPan({ scale: 1.2, x: 300, y: 300 }, boxed)).toEqual({ scale: 1.2, x: 0, y: 90 });
  });

  it("does nothing at 1x", () => {
    expect(panBy(UNZOOMED, 50, 50, wide)).toBe(UNZOOMED);
  });
});

describe("zoomTransform", () => {
  it("leaves an unzoomed video with no transform", () => {
    expect(zoomTransform(UNZOOMED)).toBe("");
    expect(zoomTransform({ scale: 2, x: 10, y: -5 })).toBe("translate(10px, -5px) scale(2)");
  });
});

describe("visibleVideoRect", () => {
  it("is the whole video at 1x", () => {
    expect(visibleVideoRect(UNZOOMED, wide, 1920, 1080)).toBeNull();
  });

  it("is the centre quarter at 2x", () => {
    expect(visibleVideoRect({ scale: 2, x: 0, y: 0 }, wide, 1920, 1080)).toEqual({ x: 480, y: 270, width: 960, height: 540 });
  });

  it("follows the pan to a corner", () => {
    expect(visibleVideoRect({ scale: 2, x: 800, y: 450 }, wide, 1920, 1080)).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it("drops the bars of a letterboxed video", () => {
    expect(visibleVideoRect({ scale: 1.2, x: 0, y: 0 }, boxed, 1440, 1080)).toEqual({ x: 0, y: 90, width: 1440, height: 900 });
  });
});
