import { describe, expect, it } from "vitest";

import { coverColorSample } from "./useCoverColorSample";

describe("coverColorSample", () => {
  it("reads a video cover from its smallest 16:9 JPEG", () => {
    expect(coverColorSample("https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg?sqp=abc")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
  });

  it("asks Google for a small crop of other art", () => {
    expect(coverColorSample("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj")).toBe(
      "https://lh3.googleusercontent.com/abc=w128-h128-p-l90-rj",
    );
  });

  it("keeps any other image, and has nothing for no cover", () => {
    expect(coverColorSample("asset://localhost/cover.jpg")).toBe("asset://localhost/cover.jpg");
    expect(coverColorSample(null)).toBeNull();
    expect(coverColorSample("  ")).toBeNull();
  });
});
