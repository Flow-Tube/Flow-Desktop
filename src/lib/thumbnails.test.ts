import { afterEach, describe, expect, it, vi } from "vitest";
import {
  avatarSize,
  buildThumbnailSources,
  resolveYoutubeThumbnailCandidates,
  upgradeAvatarUrl,
} from "./thumbnails";

const ID = "dQw4w9WgXcQ";
const MAXRES = `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`;
const HQ720 = `https://i.ytimg.com/vi/${ID}/hq720.jpg`;
const HQDEFAULT = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;
const SDDEFAULT = `https://i.ytimg.com/vi/${ID}/sddefault.jpg`;
const MQDEFAULT = `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`;
const webp = (url: string) => url.replace("/vi/", "/vi_webp/").replace(".jpg", ".webp");
const tier = (url: string) => [webp(url), url];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveYoutubeThumbnailCandidates", () => {
  it("starts a card of unknown width on hqdefault on a 1× screen", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    expect(resolveYoutubeThumbnailCandidates(ID, HQ720)).toEqual([...tier(HQDEFAULT), HQ720]);
  });

  it("starts a card of unknown width on hq720 on a HiDPI screen, falling back to hqdefault", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    expect(resolveYoutubeThumbnailCandidates(ID, HQ720)).toEqual([...tier(HQ720), ...tier(HQDEFAULT)]);
  });

  it("follows the card's drawn width", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    expect(resolveYoutubeThumbnailCandidates(ID, null, 160)).toEqual([...tier(MQDEFAULT), ...tier(HQDEFAULT)]);
    expect(resolveYoutubeThumbnailCandidates(ID, null, 288)).toEqual([...tier(SDDEFAULT), ...tier(HQDEFAULT)]);
    vi.stubGlobal("devicePixelRatio", 1);
    expect(resolveYoutubeThumbnailCandidates(ID, null, 780)).toEqual([...tier(HQ720), ...tier(HQDEFAULT)]);
  });

  it("reads the video id from a cover URL, keeping the URL itself last", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const cover = `https://i.ytimg.com/vi/${ID}/hq720.jpg?sqp=abc`;
    expect(resolveYoutubeThumbnailCandidates(null, cover, 200)).toEqual([...tier(HQDEFAULT), cover]);
  });

  it("keeps a non-YouTube URL as the last resort", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const url = "https://example.com/thumb.jpg";
    expect(resolveYoutubeThumbnailCandidates(ID, url)).toEqual([...tier(HQDEFAULT), url]);
  });
});

describe("buildThumbnailSources", () => {
  it("steps from maxresdefault through hq720 before hqdefault", () => {
    expect(buildThumbnailSources(ID, null, "large")).toEqual([MAXRES, HQ720, HQDEFAULT]);
  });

  it("falls back to hqdefault when hq720 is missing", () => {
    expect(buildThumbnailSources(ID)).toEqual([HQ720, HQDEFAULT]);
  });

  it("upgrades a URL when there is no video id", () => {
    const url = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg";
    expect(buildThumbnailSources(null, url, "large")).toEqual([
      "https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg",
      "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg",
    ]);
    expect(buildThumbnailSources(null, null)).toEqual([]);
  });
});

describe("avatarSize", () => {
  it("asks for the smallest fixed size that covers the slot on this screen", () => {
    expect(avatarSize(36, 1)).toBe(48);
    expect(avatarSize(36, 2)).toBe(88);
    expect(avatarSize(24, 2)).toBe(48);
    expect(avatarSize(64, 2)).toBe(176);
    expect(avatarSize(64, 1)).toBe(88);
  });

  it("never asks for more than three times the slot, or more than 512", () => {
    expect(avatarSize(36, 4)).toBe(176);
    expect(avatarSize(400, 3)).toBe(512);
  });

  it("puts the size into the avatar's address", () => {
    expect(upgradeAvatarUrl("https://yt3.ggpht.com/abc=s176-c-k-c0x00ffffff-no-rj", avatarSize(36, 2))).toContain("=s88");
  });
});
