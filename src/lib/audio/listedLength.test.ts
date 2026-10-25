import { describe, expect, it } from "vitest";

import { listedSeconds, pastListedEnd, playableLength } from "./listedLength";

describe("playableLength", () => {
  it("takes the listed length when WebKit doubles an AAC stream's", () => {
    expect(playableLength(490.5, 245.269)).toBe(245.269);
  });

  it("keeps the element's own length when it agrees with the listing", () => {
    expect(playableLength(245.3, 245.281)).toBe(245.3);
    expect(playableLength(250, 245)).toBe(250);
  });

  it("falls back to the listing while the element has no length", () => {
    expect(playableLength(Number.NaN, 200)).toBe(200);
    expect(playableLength(Number.POSITIVE_INFINITY, 200)).toBe(200);
    expect(playableLength(Number.NaN, null)).toBe(0);
  });

  it("trusts the element when nothing is listed", () => {
    expect(playableLength(490.5, null)).toBe(490.5);
    expect(playableLength(490.5, 0)).toBe(490.5);
  });
});

describe("pastListedEnd", () => {
  it("ends a doubled song at its listed length", () => {
    expect(pastListedEnd(245.1, 490.5, 245.269)).toBe(false);
    expect(pastListedEnd(245.3, 490.5, 245.269)).toBe(true);
  });

  it("leaves a correctly reported song to the element's own end", () => {
    expect(pastListedEnd(245.3, 245.3, 245.281)).toBe(false);
    expect(pastListedEnd(300, 245.3, null)).toBe(false);
  });
});

describe("listedSeconds", () => {
  it("prefers the stream's own length over the song's rounded one", () => {
    expect(listedSeconds({ approxDurationMs: 245269 }, { duration: 245 })).toBe(245.269);
    expect(listedSeconds({ approxDurationMs: null }, { duration: 245 })).toBe(245);
    expect(listedSeconds({ approxDurationMs: null }, { duration: null })).toBeNull();
  });
});
