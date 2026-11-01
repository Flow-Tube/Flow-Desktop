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
});
