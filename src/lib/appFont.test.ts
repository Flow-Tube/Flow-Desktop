import { describe, expect, it } from "vitest";

import { hasWeightAxis } from "./appFont";

/** A minimal sfnt with one table directory entry and, when given, an fvar table naming `axes`. */
function sfnt(axes: string[] | null): Uint8Array {
  const fvarAt = 28;
  const axisSize = 20;
  const bytes = new Uint8Array(fvarAt + 16 + axisSize * (axes?.length ?? 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  const tag = axes ? "fvar" : "name";
  for (let i = 0; i < 4; i++) bytes[12 + i] = tag.charCodeAt(i);
  view.setUint32(20, fvarAt);
  if (axes) {
    view.setUint16(fvarAt + 4, 16);
    view.setUint16(fvarAt + 8, axes.length);
    view.setUint16(fvarAt + 10, axisSize);
    axes.forEach((axis, k) => {
      for (let i = 0; i < 4; i++) bytes[fvarAt + 16 + k * axisSize + i] = axis.charCodeAt(i);
    });
  }
  return bytes;
}

describe("custom font weights", () => {
  it("finds a weight axis in a variable font", () => {
    expect(hasWeightAxis(sfnt(["wdth", "wght"]))).toBe(true);
  });

  it("treats a font without one as static", () => {
    expect(hasWeightAxis(sfnt(["wdth"]))).toBe(false);
    expect(hasWeightAxis(sfnt(null))).toBe(false);
  });

  it("survives a cut-off file", () => {
    expect(hasWeightAxis(sfnt(["wght"]).slice(0, 30))).toBe(false);
    expect(hasWeightAxis(new Uint8Array(4))).toBe(false);
  });
});
