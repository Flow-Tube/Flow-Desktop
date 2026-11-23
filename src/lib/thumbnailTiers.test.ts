import { describe, expect, it } from "vitest";

import { pickThumbnailTier, thumbnailSources } from "./thumbnailTiers";

const ID = "dQw4w9WgXcQ";
const tier = (cssWidth: number | undefined, pixelRatio: number) => pickThumbnailTier(cssWidth, pixelRatio).name;

describe("pickThumbnailTier", () => {
  it("draws related and list rows from the small tiers", () => {
    expect(tier(160, 1)).toBe("mqdefault");
    expect(tier(192, 1)).toBe("mqdefault");
    expect(tier(160, 2)).toBe("mqdefault");
    expect(tier(192, 2)).toBe("hqdefault");
    expect(tier(192, 1.5)).toBe("mqdefault");
  });

  it("draws search rows at each breakpoint width", () => {
    expect(tier(360, 1)).toBe("hqdefault");
    expect(tier(288, 2)).toBe("sddefault");
    expect(tier(360, 2)).toBe("hq720");
  });

  it("follows a grid's column width", () => {
    // Six, four and two columns on a 1600 px window.
    expect(tier(250, 1)).toBe("mqdefault");
    expect(tier(380, 1)).toBe("hqdefault");
    expect(tier(780, 1)).toBe("hq720");
    expect(tier(250, 2)).toBe("hqdefault");
    expect(tier(320, 2)).toBe("sddefault");
    expect(tier(380, 2)).toBe("hq720");
    expect(tier(380, 1.5)).toBe("sddefault");
  });

  it("accepts a tier up to a tenth narrower than the card", () => {
    expect(tier(355, 1)).toBe("mqdefault");
    expect(tier(356, 1)).toBe("hqdefault");
  });

  it("keeps the screen's guess when the width is unknown", () => {
    expect(tier(undefined, 1)).toBe("hqdefault");
    expect(tier(0, 2)).toBe("hq720");
  });

  it("stops at hq720 for a card wider than it", () => {
    expect(tier(1600, 2)).toBe("hq720");
  });
});

describe("thumbnailSources", () => {
  it("tries each tier as WebP, then JPEG, ending on hqdefault", () => {
    expect(thumbnailSources(ID, pickThumbnailTier(360, 2))).toEqual([
      `https://i.ytimg.com/vi_webp/${ID}/hq720.webp`,
      `https://i.ytimg.com/vi/${ID}/hq720.jpg`,
      `https://i.ytimg.com/vi_webp/${ID}/hqdefault.webp`,
      `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    ]);
    expect(thumbnailSources(ID, pickThumbnailTier(380, 1))).toEqual([
      `https://i.ytimg.com/vi_webp/${ID}/hqdefault.webp`,
      `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    ]);
  });
});
