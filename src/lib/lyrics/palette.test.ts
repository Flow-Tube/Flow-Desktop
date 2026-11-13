import { describe, expect, it } from "vitest";

import { luminance } from "../color/tone";
import { backdropColor, cardColors, cardScheme, colorDistance, inkFor } from "./palette";

const rgb = (r: number, g: number, b: number) => ({ r, g, b });
const cover = { backdrop: rgb(60, 30, 90), mesh: new Uint8ClampedArray(4) };
const swatches = { base: rgb(30, 60, 40), accent: rgb(240, 120, 30) };

describe("lyric card colours", () => {
  it("measures colour distance on a 0 to 1 scale and picks the ink that reads best", () => {
    expect(colorDistance(rgb(0, 0, 0), rgb(0, 0, 0))).toBe(0);
    expect(colorDistance(rgb(32, 32, 32), rgb(36, 36, 36))).toBeLessThan(0.06);
    expect(inkFor(rgb(250, 240, 220))).toEqual(rgb(17, 17, 17));
    expect(inkFor(rgb(30, 20, 60))).toEqual(rgb(255, 255, 255));
  });

  it("offers Android's nine looks, in its order, for a colourful cover", () => {
    const ids = cardColors(cover, swatches, { primary: rgb(255, 255, 255), light: false }).styles.map((style) => style.id);
    expect(ids).toEqual(["artwork", "colorful", "surface", "inverse", "primary", "primaryContainer", "secondaryContainer", "tertiary", "tertiaryContainer"]);
  });

  it("drops look-alikes and leaves out the cover looks without a cover", () => {
    const ids = cardColors(null, null, { primary: rgb(128, 128, 128), light: false }).styles.map((style) => style.id);
    expect(ids).not.toContain("colorful");
    expect(ids).not.toContain("artwork");
    expect(ids).toContain("surface");
    expect(ids.length).toBeLessThan(9);
  });

  it("builds dark roles on a dark app and light ones on a light app", () => {
    const dark = cardScheme(swatches.accent, false);
    const light = cardScheme(swatches.accent, true);
    expect(luminance(dark.surfaceContainerHighest)).toBeLessThan(0.1);
    expect(luminance(light.surfaceContainerHighest)).toBeGreaterThan(0.6);
    expect(luminance(dark.primary)).toBeGreaterThan(luminance(dark.onPrimary));
    expect(luminance(light.primary)).toBeLessThan(luminance(light.onPrimary));
  });

  it("frames the card in the cover's accent unless the card already is that colour", () => {
    const colors = cardColors(cover, swatches, null);
    expect(backdropColor(rgb(20, 20, 20), colors)).toEqual(swatches.accent);
    expect(backdropColor(swatches.accent, colors)).toEqual(colors.scheme.inverseSurface);
  });
});
