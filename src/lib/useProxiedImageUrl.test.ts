import { describe, expect, it } from "vitest";
import { heldProxiedUrl, holdProxiedUrl, PROXIED_URL_LIFETIME_MS } from "./useProxiedImageUrl";

describe("held proxied image addresses", () => {
  const src = "https://lh3.googleusercontent.com/cover=w544";
  const local = "http://127.0.0.1:5001/stream/img-1";

  it("hands an address out again while the backend still serves it", () => {
    holdProxiedUrl(src, local, 1_000);
    expect(heldProxiedUrl(src, 1_000 + PROXIED_URL_LIFETIME_MS - 1)).toBe(local);
  });

  it("forgets an address before the backend's six hours are up, so it is asked for again", () => {
    holdProxiedUrl(src, local, 1_000);
    expect(PROXIED_URL_LIFETIME_MS).toBeLessThan(6 * 60 * 60 * 1000);
    expect(heldProxiedUrl(src, 1_000 + PROXIED_URL_LIFETIME_MS)).toBeUndefined();
    expect(heldProxiedUrl(src, 1_000)).toBeUndefined();
  });

  it("knows nothing about an image it was never given", () => {
    expect(heldProxiedUrl("https://example.com/never.jpg")).toBeUndefined();
  });
});
