import { describe, expect, it } from "vitest";

import { COVER_CELLS, MESH_SIZE, coverMesh, coverScrim, luminance, lyricsCover } from "./coverMesh";

const cover = (fill: (i: number) => [number, number, number]) => {
  const pixels = new Uint8ClampedArray(COVER_CELLS * COVER_CELLS * 4);
  for (let i = 0; i < COVER_CELLS * COVER_CELLS; i++) pixels.set([...fill(i), 255], i * 4);
  return pixels;
};
const contrastWithWhite = (c: { r: number; g: number; b: number }) => 1.05 / (luminance(c) + 0.05);

describe("lyrics cover backgrounds", () => {
  it("darkens a bright cover until white text reads at 7:1 on its brightest cell", () => {
    const { backdrop } = lyricsCover(cover((i) => (i === 0 ? [255, 255, 255] : [240, 200, 40])));
    expect(contrastWithWhite(backdrop)).toBeGreaterThanOrEqual(7);
  });

  it("darkens a dark cover only by the minimum", () => {
    expect(coverScrim([{ r: 20, g: 20, b: 30 }])).toBeCloseTo(0.3);
  });

  it("keeps each cell's colour at its own corner and blends smoothly between", () => {
    const cells = Array.from({ length: 4 }, (_, i) => ({ r: i === 0 ? 200 : 0, g: 0, b: 0 }));
    const mesh = coverMesh(cells, 2, 5);
    const red = (x: number, y: number) => mesh[(y * 5 + x) * 4]!;
    expect(red(0, 0)).toBeGreaterThan(red(1, 0));
    expect(red(1, 0)).toBeGreaterThan(red(2, 0));
    expect(red(4, 4)).toBe(0);
  });

  it("makes a mesh of the full size, opaque everywhere", () => {
    const { mesh } = lyricsCover(cover((i) => [i * 3, 100, 200 - i]));
    expect(mesh.length).toBe(MESH_SIZE * MESH_SIZE * 4);
    expect(mesh.every((value, i) => i % 4 !== 3 || value === 255)).toBe(true);
  });
});
