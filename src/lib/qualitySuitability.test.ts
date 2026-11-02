import { describe, expect, it } from "vitest";
import { evaluateQualitySuitability } from "./qualitySuitability";
import type { StreamVariant } from "../types/video";

function createVariant(height: number, id = `variant-${height}`): StreamVariant {
  return {
    id,
    localUrl: `http://localhost/video-${height}.mp4`,
    qualityLabel: `${height}p`,
    height,
    width: Math.round((height * 16) / 9),
    fps: 30,
    bitrate: height * 5000,
    isDefault: false,
    isPlayable: true,
    hasAudio: true,
    isVideoOnly: false,
    deliveryMethod: "dash",
  };
}

describe("qualitySuitability", () => {
  it("flags 8K (4320p) as demanding", () => {
    const variant8k = createVariant(4320);
    const result = evaluateQualitySuitability(variant8k);
    expect(result.tier).toBe("demanding");
    expect(result.isDemanding).toBe(true);
    expect(result.badgeKey).toBe("player_quality_demanding");
  });

  it("marks 1080p as recommended", () => {
    const variant1080 = createVariant(1080);
    const result = evaluateQualitySuitability(variant1080);
    expect(result.tier).toBe("recommended");
    expect(result.isRecommended).toBe(true);
    expect(result.badgeKey).toBe("player_quality_recommended");
  });

  it("flags variants where hardware probe indicates isSmooth: false as demanding", () => {
    const variant1440 = createVariant(1440);
    const result = evaluateQualitySuitability(variant1440, { isSmooth: false });
    expect(result.tier).toBe("demanding");
    expect(result.isDemanding).toBe(true);
  });

  it("marks 1440p as recommended on high-resolution displays", () => {
    const variant1440 = createVariant(1440);
    const result = evaluateQualitySuitability(variant1440, {
      screenHeight: 1440,
      dpr: 1,
      isSmooth: true,
    });
    expect(result.tier).toBe("recommended");
    expect(result.isRecommended).toBe(true);
  });

  it("marks 720p as standard when 1080p is available", () => {
    const variant720 = createVariant(720);
    const variant1080 = createVariant(1080);
    const result = evaluateQualitySuitability(variant720, {
      allQualities: [variant720, variant1080],
    });
    expect(result.tier).toBe("standard");
    expect(result.isRecommended).toBeFalsy();
    expect(result.isDemanding).toBeFalsy();
  });

  it("marks highest available resolution as recommended for older videos capped below 1080p", () => {
    const variant720 = createVariant(720);
    const variant480 = createVariant(480);
    const result = evaluateQualitySuitability(variant720, {
      allQualities: [variant480, variant720],
    });
    expect(result.tier).toBe("recommended");
    expect(result.isRecommended).toBe(true);
  });

  it("handles variants without height gracefully", () => {
    const variant = { ...createVariant(0), height: null };
    const result = evaluateQualitySuitability(variant);
    expect(result.tier).toBe("standard");
  });
});
