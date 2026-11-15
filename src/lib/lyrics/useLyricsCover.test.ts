import { describe, expect, it, vi } from "vitest";

import { readLyricsCover } from "./useLyricsCover";

describe("readLyricsCover", () => {
  it("returns null when naturalWidth is 0", () => {
    const img = { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement;
    expect(readLyricsCover(img)).toBeNull();
  });

  it("crops non-square images to a square before sampling", () => {
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray(8 * 8 * 4),
    }));

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingQuality: "low",
            drawImage,
            getImageData,
          }),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    // 16:9 widescreen image (1600x900)
    const wideImg = { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement;
    const result = readLyricsCover(wideImg);
    expect(result).not.toBeNull();

    // Verify drawImage was called with a square crop from the center
    expect(drawImage).toHaveBeenCalledWith(
      wideImg,
      (1600 - 900) / 2, // sx = 350
      0,                // sy = 0
      900,              // side = 900
      900,              // side = 900
      0,
      0,
      8,
      8,
    );

    vi.restoreAllMocks();
  });
});
