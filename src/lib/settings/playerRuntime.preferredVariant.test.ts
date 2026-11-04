import { describe, expect, it } from "vitest";
import type { StreamVariant } from "../../types/video";
import { selectPreferredStreamVariant } from "./playerRuntime";

const variant = (id: string, height: number, codec: string, label = `${height}p`): StreamVariant =>
  ({
    id,
    height,
    qualityLabel: label,
    mimeType: `video/mp4; codecs="${codec}"`,
    isPlayable: true,
    hasAudio: true,
    bitrate: height,
  }) as StreamVariant;

const variants = [
  variant("h264-1080", 1080, "avc1.640028"),
  variant("vp9-1080", 1080, "vp9"),
  variant("av1-1080", 1080, "av01.0.08M.08"),
  variant("vp9-2160", 2160, "vp9"),
  variant("av1-2160", 2160, "av01.0.12M.08"),
  variant("vp9-hdr-2160", 2160, "vp9.2", "2160p HDR"),
  variant("av1-hdr-4320", 4320, "av01.0.17M.10", "4320p HDR"),
];

const pick = (quality: string, codec: string) =>
  selectPreferredStreamVariant(variants, quality, codec, true)?.id;

describe("selectPreferredStreamVariant", () => {
  it("keeps the default 1080p on H.264", () => {
    expect(pick("1080p", "H.264")).toBe("h264-1080");
  });

  it("reaches a 4K preference even with H.264 preferred", () => {
    expect(pick("2160p", "H.264")).toBe("vp9-2160");
  });

  it("uses the preferred codec at the chosen height", () => {
    expect(pick("2160p", "AV1")).toBe("av1-2160");
    expect(pick("1080p", "VP9")).toBe("vp9-1080");
  });

  it("doesn't pick HDR when the same resolution has a normal row", () => {
    expect(pick("2160p", "Auto")).toBe("vp9-2160");
  });

  it("picks HDR when nothing else reaches that resolution", () => {
    expect(pick("4320p", "Auto")).toBe("av1-hdr-4320");
  });

  it("leaves Auto to the player", () => {
    expect(selectPreferredStreamVariant(variants, "Auto", "H.264", true)).toBeNull();
  });
});
