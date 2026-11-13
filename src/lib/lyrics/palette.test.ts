import { describe, expect, it } from "vitest";
import {
  colorDistance,
  distinctCardStyles,
  hexToRgb,
  isLightColor,
  looksAlike,
  rgbToHex,
  type CardStyleOption,
} from "./palette";

describe("lyrics/palette", () => {
  it("converts rgb to hex and back accurately", () => {
    const rgb = { r: 255, g: 128, b: 64 };
    const hex = rgbToHex(rgb);
    expect(hex.toLowerCase()).toBe("#ff8040");

    const parsed = hexToRgb(hex);
    expect(parsed).toEqual(rgb);
  });

  it("detects light and dark colors correctly", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#f8f9fa")).toBe(true);
    expect(isLightColor("#fed7aa")).toBe(true); // light peach
    expect(isLightColor("#000000")).toBe(false);
    expect(isLightColor("#121212")).toBe(false);
    expect(isLightColor("#1e293b")).toBe(false);
    expect(isLightColor("#4c0519")).toBe(false); // deep wine
    expect(isLightColor("cover")).toBe(false);
  });

  it("computes normalized Euclidean color distance accurately", () => {
    // Identical colors
    expect(colorDistance("#112233", "#112233")).toBe(0);

    // Very close colors (distance < 0.06)
    expect(looksAlike("#202020", "#242424")).toBe(true);

    // Different colors (distance >= 0.06)
    expect(looksAlike("#000000", "#ffffff")).toBe(false);
    expect(looksAlike("#ff0000", "#00ff00")).toBe(false);
  });

  it("deduplicates styles with similar ground colors while preserving cover", () => {
    const styles: CardStyleOption[] = [
      { id: "cover", label: "Cover", ground: "#121212", hex: "#121212", ink: "#ffffff", isCover: true, isLight: false },
      { id: "dark1", label: "Dark 1", ground: "#121212", hex: "#121212", ink: "#ffffff", isLight: false },
      { id: "dark2", label: "Dark 2", ground: "#141414", hex: "#141414", ink: "#ffffff", isLight: false }, // Should be dropped
      { id: "accent", label: "Red", ground: "#e11d48", hex: "#e11d48", ink: "#ffffff", isLight: false },
    ];

    const result = distinctCardStyles(styles);
    expect(result.map((s) => s.id)).toEqual(["cover", "dark1", "accent"]);
  });
});
