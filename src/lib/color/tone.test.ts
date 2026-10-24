import { describe, expect, it } from "vitest";

import { contrastRatio, ensureContrastOn, fromLab, parseHex, tone, toLab, withTone } from "./tone";

describe("tone", () => {
  it("measures CIELAB lightness like AndroidX ColorUtils", () => {
    expect(tone({ r: 255, g: 255, b: 255 })).toBeCloseTo(100, 1);
    expect(tone({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 1);
    expect(tone({ r: 119, g: 119, b: 119 })).toBeCloseTo(50, 0);
    const [l, a, b] = toLab({ r: 255, g: 0, b: 0 });
    expect(l).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 0);
    expect(b).toBeCloseTo(67.2, 0);
  });

  it("round-trips through Lab", () => {
    for (const color of [{ r: 12, g: 200, b: 99 }, { r: 240, g: 30, b: 180 }, { r: 70, g: 70, b: 70 }]) {
      const [l, a, b] = toLab(color);
      expect(fromLab(l, a, b)).toEqual(color);
    }
  });

  it("re-tones a colour and caps its chroma", () => {
    const red = { r: 220, g: 30, b: 40 };
    // A muted colour stays in gamut at tone 26; a saturated one is clipped
    // lighter, exactly as AndroidX's LABToColor clips it.
    expect(tone(withTone({ r: 140, g: 90, b: 80 }, 26))).toBeCloseTo(26, 0);
    const pale = withTone(red, 90, 24);
    const [, a, b] = toLab(pale);
    expect(Math.hypot(a, b)).toBeLessThanOrEqual(24.5);
  });

  it("lifts a colour off a dark surface until it reads, and darkens one off a light surface", () => {
    const darkSurface = { r: 30, g: 30, b: 34 };
    const lifted = ensureContrastOn({ r: 40, g: 40, b: 120 }, darkSurface, 4.5);
    expect(contrastRatio(lifted, darkSurface)).toBeGreaterThanOrEqual(4.5);
    const lightSurface = { r: 245, g: 243, b: 240 };
    const darkened = ensureContrastOn({ r: 250, g: 220, b: 90 }, lightSurface, 4.5);
    expect(contrastRatio(darkened, lightSurface)).toBeGreaterThanOrEqual(4.5);
  });

  it("parses only plain hex", () => {
    expect(parseHex("#FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex("color-mix(in srgb, red 50%, blue)")).toBeNull();
  });
});
