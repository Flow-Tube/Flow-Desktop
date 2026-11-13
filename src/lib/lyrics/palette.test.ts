import { describe, expect, it } from "vitest";

import { cardStyles, colorDistance, distinctCardStyles, inkFor, type CardStyle } from "./palette";

const rgb = (r: number, g: number, b: number) => ({ r, g, b });
const theme = { surface: rgb(40, 40, 40), onSurface: rgb(240, 240, 240), primary: rgb(255, 78, 69), onPrimary: rgb(255, 255, 255) };

describe("lyric card looks", () => {
  it("measures colour distance on a 0 to 1 scale", () => {
    expect(colorDistance(rgb(0, 0, 0), rgb(0, 0, 0))).toBe(0);
    expect(colorDistance(rgb(32, 32, 32), rgb(36, 36, 36))).toBeLessThan(0.06);
  });

  it("picks the ink that reads best", () => {
    expect(inkFor(rgb(250, 240, 220))).toEqual(rgb(17, 17, 17));
    expect(inkFor(rgb(30, 20, 60))).toEqual(rgb(255, 255, 255));
  });

  it("drops look-alike grounds but always keeps the cover", () => {
    const styles: CardStyle[] = [
      { id: "cover", ground: rgb(20, 20, 20), ink: rgb(255, 255, 255), mesh: new Uint8ClampedArray(4) },
      { id: "artwork", ground: rgb(20, 20, 20), ink: rgb(255, 255, 255) },
      { id: "surface", ground: rgb(22, 22, 22), ink: rgb(255, 255, 255) },
      { id: "primary", ground: rgb(225, 29, 72), ink: rgb(255, 255, 255) },
    ];
    expect(distinctCardStyles(styles).map((style) => style.id)).toEqual(["cover", "artwork", "primary"]);
  });

  it("offers the cover, its swatches and the app theme, in Android's order", () => {
    const cover = { backdrop: rgb(60, 30, 90), mesh: new Uint8ClampedArray(4) };
    const ids = cardStyles(cover, { base: rgb(30, 60, 40), accent: rgb(240, 180, 30) }, theme).map((style) => style.id);
    expect(ids).toEqual(["cover", "artwork", "accent", "surface", "inverse", "primary"]);
    expect(cardStyles(null, null, theme)[0]).toMatchObject({ id: "surface", ground: theme.surface, ink: theme.onSurface });
  });

  it("still offers a look when neither the cover nor the theme can be read", () => {
    expect(cardStyles(null, null, null)).toHaveLength(1);
  });
});
