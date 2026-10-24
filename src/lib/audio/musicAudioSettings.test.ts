import { describe, expect, it, vi } from "vitest";

const { player } = vi.hoisted(() => {
  const state = {
    normalizationEnabled: true,
    setNormalizationEnabled: vi.fn((enabled: boolean) => {
      state.normalizationEnabled = enabled;
    }),
  };
  return { player: state };
});

vi.mock("../../store/useMusicPlayerStore", () => ({
  useMusicPlayerStore: { getState: () => player },
}));
vi.mock("../api/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));

import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";
import { bindMusicAudioSettings } from "./musicAudioSettings";

describe("bindMusicAudioSettings", () => {
  it("follows the saved normalization switch, including later changes", () => {
    bindMusicAudioSettings();
    expect(player.setNormalizationEnabled).not.toHaveBeenCalled();

    useAppSettingsStore.setState((s) => ({
      values: { ...s.values, [SETTINGS.MUSIC_LOUDNESS_NORMALIZATION]: "false" },
    }));
    expect(player.normalizationEnabled).toBe(false);

    useAppSettingsStore.setState((s) => ({
      values: { ...s.values, [SETTINGS.MUSIC_LOUDNESS_NORMALIZATION]: "true" },
    }));
    expect(player.normalizationEnabled).toBe(true);
    expect(player.setNormalizationEnabled).toHaveBeenCalledTimes(2);
  });
});
