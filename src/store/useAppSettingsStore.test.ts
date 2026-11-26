import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  stored: {} as Record<string, string>,
  getSetting: vi.fn(),
  setSetting: vi.fn(async () => undefined),
}));
vi.mock("../lib/api/db", () => ({
  getSetting: db.getSetting,
  setSetting: db.setSetting,
}));

import { SETTINGS } from "../lib/settings/schema";
import { getSettingValue, useAppSettingsStore } from "./useAppSettingsStore";
import { useSettingsStore } from "./useSettingsStore";

// Each read waits a macrotask, like a real IPC round trip.
db.getSetting.mockImplementation(
  (key: string) => new Promise((resolve) => setTimeout(() => resolve(db.stored[key] ?? null), 0)),
);

describe("useAppSettingsStore.loadSettings", () => {
  beforeEach(() => {
    db.stored = { [SETTINGS.DISCORD_RPC_MODE]: "music" };
    db.getSetting.mockClear();
    useAppSettingsStore.setState({ values: {}, loaded: false, lastError: null });
  });

  it("makes a caller that arrives mid-load wait for the stored values", async () => {
    void useAppSettingsStore.getState().loadSettings();
    await useAppSettingsStore.getState().loadSettings();

    expect(getSettingValue(SETTINGS.DISCORD_RPC_MODE)).toBe("music");
  });

  it("reads the database once for overlapping calls and again for a later one", async () => {
    await Promise.all([
      useAppSettingsStore.getState().loadSettings(),
      useAppSettingsStore.getState().loadSettings(),
    ]);
    const readsPerLoad = db.getSetting.mock.calls.length;

    db.stored[SETTINGS.DISCORD_RPC_MODE] = "videos";
    await useAppSettingsStore.getState().loadSettings();

    expect(db.getSetting.mock.calls.length).toBe(readsPerLoad * 2);
    expect(getSettingValue(SETTINGS.DISCORD_RPC_MODE)).toBe("videos");
  });

  it("gives the startup settings load the stored Discord mode", async () => {
    // App.tsx starts both loads back to back.
    void useAppSettingsStore.getState().loadSettings();
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().discordMode).toBe("music");
  });
});
