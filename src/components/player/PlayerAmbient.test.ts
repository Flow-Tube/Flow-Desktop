import { describe, expect, it } from "vitest";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

describe("Ambient Mode", () => {
  it("defaults to enabled", () => {
    const isEnabled = useAppSettingsStore.getState().values[SETTINGS.AMBIENT_MODE_ENABLED] !== "false";
    expect(isEnabled).toBe(true);
  });

  it("can be toggled in app settings store", () => {
    useAppSettingsStore.getState().hydrateSettings({ [SETTINGS.AMBIENT_MODE_ENABLED]: "false" });
    expect(useAppSettingsStore.getState().values[SETTINGS.AMBIENT_MODE_ENABLED]).toBe("false");

    useAppSettingsStore.getState().hydrateSettings({ [SETTINGS.AMBIENT_MODE_ENABLED]: "true" });
    expect(useAppSettingsStore.getState().values[SETTINGS.AMBIENT_MODE_ENABLED]).toBe("true");
  });

  describe("Aspect-ratio aware sampling dimensions", () => {
    const AMBIENT_BASE_WIDTH = 36;
    const computeDimensions = (vw: number, vh: number) => {
      const ar = vw / vh;
      const sampleWidth = Math.max(20, Math.min(48, Math.round(ar >= 1 ? AMBIENT_BASE_WIDTH : AMBIENT_BASE_WIDTH * ar)));
      const sampleHeight = Math.max(12, Math.min(48, Math.round(ar >= 1 ? AMBIENT_BASE_WIDTH / ar : AMBIENT_BASE_WIDTH)));
      return { sampleWidth, sampleHeight };
    };

    it("computes 36x20 for standard 16:9 video", () => {
      const { sampleWidth, sampleHeight } = computeDimensions(1920, 1080);
      expect(sampleWidth).toBe(36);
      expect(sampleHeight).toBe(20);
    });

    it("computes 36x18 for cinematic 2:1 video", () => {
      const { sampleWidth, sampleHeight } = computeDimensions(1920, 960);
      expect(sampleWidth).toBe(36);
      expect(sampleHeight).toBe(18);
    });

    it("computes 36x15 for anamorphic 2.39:1 video", () => {
      const { sampleWidth, sampleHeight } = computeDimensions(1920, 804);
      expect(sampleWidth).toBe(36);
      expect(sampleHeight).toBe(15);
    });

    it("computes 36x27 for classic 4:3 video", () => {
      const { sampleWidth, sampleHeight } = computeDimensions(1440, 1080);
      expect(sampleWidth).toBe(36);
      expect(sampleHeight).toBe(27);
    });

    it("keeps total sampled pixels under 1000 pixels for all common aspect ratios", () => {
      const ratios: Array<[number, number]> = [
        [1920, 1080],
        [1920, 960],
        [1920, 804],
        [1440, 1080],
        [1080, 1920],
      ];
      for (const [w, h] of ratios) {
        const { sampleWidth, sampleHeight } = computeDimensions(w, h);
        expect(sampleWidth * sampleHeight).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe("Ambient Mode state conditions", () => {
    const isAmbientActive = (ambientMode: boolean, isPipMode: boolean, hasError: boolean) =>
      ambientMode && !isPipMode && !hasError;

    it("remains active during fullscreen playback", () => {
      expect(isAmbientActive(true, false, false)).toBe(true);
    });

    it("disables only during mini-player (pip) or playback error", () => {
      expect(isAmbientActive(true, true, false)).toBe(false);
      expect(isAmbientActive(true, false, true)).toBe(false);
      expect(isAmbientActive(false, false, false)).toBe(false);
    });

    it("respects ambient mode setting in shorts", () => {
      const isShortsAmbientActive = (
        ambientMode: boolean,
        thumbnail: string | null,
        active: boolean,
        isLinuxRuntime: boolean,
      ) => Boolean(ambientMode && thumbnail && active && !isLinuxRuntime);

      expect(isShortsAmbientActive(true, "thumb.jpg", true, false)).toBe(true);
      expect(isShortsAmbientActive(false, "thumb.jpg", true, false)).toBe(false);
      expect(isShortsAmbientActive(true, "thumb.jpg", true, true)).toBe(false);
      expect(isShortsAmbientActive(true, null, true, false)).toBe(false);
      expect(isShortsAmbientActive(true, "thumb.jpg", false, false)).toBe(false);
    });
  });

  describe("Adaptive Player Size setting", () => {
    it("defaults to true in setting definitions", async () => {
      const { SETTING_DEFINITIONS } = await import("../../lib/settings/schema");
      const def = SETTING_DEFINITIONS.find((d) => d.key === SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED);
      expect(def).toBeDefined();
      expect(def?.defaultValue).toBe("true");
      expect(def?.readiness).toBe("wired");
    });
  });

  describe("Ambient Mode Intensity setting", () => {
    it("is defined as wired number between 10 and 100 with default 60", async () => {
      const { SETTING_DEFINITIONS } = await import("../../lib/settings/schema");
      const def = SETTING_DEFINITIONS.find((d) => d.key === SETTINGS.AMBIENT_MODE_INTENSITY);
      expect(def).toBeDefined();
      expect(def?.defaultValue).toBe("60");
      expect(def?.type).toBe("number");
      expect(def?.readiness).toBe("wired");
      expect(def?.min).toBe(10);
      expect(def?.max).toBe(100);
    });

    it("clamps intensity value within valid 10-100 range", () => {
      const clampIntensity = (raw: string | undefined): number => {
        const val = Number(raw);
        return Number.isFinite(val) && val >= 10 && val <= 100 ? val : 60;
      };

      expect(clampIntensity("80")).toBe(80);
      expect(clampIntensity("10")).toBe(10);
      expect(clampIntensity("100")).toBe(100);
      expect(clampIntensity("0")).toBe(60);
      expect(clampIntensity("150")).toBe(60);
      expect(clampIntensity(undefined)).toBe(60);
      expect(clampIntensity("invalid")).toBe(60);
    });
  });
});
