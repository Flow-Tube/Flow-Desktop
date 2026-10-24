import { describe, expect, it } from "vitest";

import { artworkSwatches, quantizeSwatches } from "./artworkSwatches";

function image(parts: { rgb: [number, number, number]; share: number }[], side = 112): Uint8ClampedArray {
  const total = side * side;
  const data = new Uint8ClampedArray(total * 4);
  let offset = 0;
  for (const { rgb, share } of parts) {
    const count = Math.round(total * share);
    for (let i = 0; i < count && offset < total; i++, offset++) {
      data.set([...rgb, 255], offset * 4);
    }
  }
  return data;
}

describe("artworkSwatches", () => {
  it("takes a dark muted base and a vibrant accent from a cover", () => {
    const pixels = image([
      { rgb: [40, 44, 52], share: 0.6 }, // dark slate background
      { rgb: [230, 40, 60], share: 0.25 }, // vivid red title
      { rgb: [200, 200, 200], share: 0.15 },
    ]);
    const { base, accent } = artworkSwatches(pixels);
    expect(base).not.toBeNull();
    expect(accent).not.toBeNull();
    expect(base!.r).toBeLessThan(80);
    expect(accent!.r).toBeGreaterThan(180);
    expect(accent!.g).toBeLessThan(90);
  });

  it("ignores near-black and near-white, leaving nothing for a pure black and white cover", () => {
    const pixels = image([
      { rgb: [0, 0, 0], share: 0.5 },
      { rgb: [255, 255, 255], share: 0.5 },
    ]);
    expect(artworkSwatches(pixels)).toEqual({ base: null, accent: null });
  });

  it("cuts a many-coloured image down to at most 16 swatches", () => {
    const parts = Array.from({ length: 64 }, (_, i) => ({
      rgb: [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256] as [number, number, number],
      share: 1 / 64,
    }));
    expect(quantizeSwatches(image(parts)).length).toBeLessThanOrEqual(16);
  });
});
