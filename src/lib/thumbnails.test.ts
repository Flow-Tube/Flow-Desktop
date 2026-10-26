import { afterEach, describe, expect, it, vi } from "vitest";
import { buildThumbnailSources, resolveYoutubeThumbnailCandidates } from "./thumbnails";

const ID = "dQw4w9WgXcQ";
const HQ720 = `https://i.ytimg.com/vi/${ID}/hq720.jpg`;
const HQDEFAULT = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveYoutubeThumbnailCandidates", () => {
  it("starts a card on hqdefault on a 1× screen", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    expect(resolveYoutubeThumbnailCandidates(ID, HQ720)).toEqual([HQDEFAULT, HQ720]);
  });

  it("starts a card on hq720 on a HiDPI screen, falling back to hqdefault", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    expect(resolveYoutubeThumbnailCandidates(ID, HQ720)).toEqual([HQ720, HQDEFAULT]);
  });

  it("keeps a non-YouTube URL as the last resort", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const url = "https://example.com/thumb.jpg";
    expect(resolveYoutubeThumbnailCandidates(ID, url)).toEqual([HQDEFAULT, url]);
  });
});

describe("buildThumbnailSources", () => {
  it("falls back to hqdefault when hq720 is missing", () => {
    expect(buildThumbnailSources(ID)).toEqual({ primary: HQ720, fallback: HQDEFAULT });
  });
});
