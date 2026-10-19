import { describe, expect, it } from "vitest";
import { originalImageUrl, proxiedImage } from "./imageProxy";

const BASE = "http://127.0.0.1:41234/img/abc123";
const THUMB = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg";

describe("proxiedImage", () => {
  it("leaves every URL alone without a proxy", () => {
    expect(proxiedImage(THUMB, null)).toBe(THUMB);
  });

  it("routes YouTube image hosts through the proxy", () => {
    for (const url of [
      THUMB,
      "https://i9.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://yt3.ggpht.com/abc=s88",
      "https://lh3.googleusercontent.com/abc=w544",
      "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=dQw4w9WgXcQ&time=12",
    ]) {
      expect(proxiedImage(url, BASE)).toBe(`${BASE}?u=${encodeURIComponent(url)}`);
    }
  });

  it("leaves other hosts, plain http and local URLs alone", () => {
    for (const url of [
      "https://example.com/a.jpg",
      "https://i.ytimg.com.example.com/a.jpg",
      "http://i.ytimg.com/vi/x/hq720.jpg",
      "http://127.0.0.1:5000/stream/img-1",
      "data:image/png;base64,AAAA",
      "not a url",
    ]) {
      expect(proxiedImage(url, BASE)).toBe(url);
    }
  });
});

describe("originalImageUrl", () => {
  it("unwraps a proxied URL", () => {
    expect(originalImageUrl(proxiedImage(THUMB, BASE))).toBe(THUMB);
  });

  it("returns any other URL unchanged", () => {
    expect(originalImageUrl(THUMB)).toBe(THUMB);
    expect(originalImageUrl("http://127.0.0.1:5000/stream/img-1")).toBe("http://127.0.0.1:5000/stream/img-1");
  });
});
