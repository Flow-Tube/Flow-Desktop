import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateSupport } from "../lib/updateSupport";

const checkForAppUpdate = vi.fn();
const getUpdateSupport = vi.fn<() => Promise<UpdateSupport>>();

vi.mock("../lib/api/updater", () => ({
  checkForAppUpdate: (...args: unknown[]) => checkForAppUpdate(...args),
  getUpdateSupport: () => getUpdateSupport(),
  downloadAndInstallUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

vi.mock("../lib/api/db", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
}));

const { useUpdaterStore } = await import("./useUpdaterStore");

describe("useUpdaterStore.checkForUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdaterStore.setState({ phase: "idle", support: null });
  });

  it("never asks the updater when the install can't update itself", async () => {
    getUpdateSupport.mockResolvedValue({ supported: false, reason: "flatpak" });

    await expect(useUpdaterStore.getState().checkForUpdates({ silent: true })).resolves.toBe(
      "unsupported",
    );
    expect(checkForAppUpdate).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().support).toEqual({ supported: false, reason: "flatpak" });
    expect(useUpdaterStore.getState().phase).toBe("idle");
  });

  it("checks normally when updates are supported", async () => {
    getUpdateSupport.mockResolvedValue({ supported: true, reason: null });
    checkForAppUpdate.mockResolvedValue(null);

    await expect(useUpdaterStore.getState().checkForUpdates()).resolves.toBe("uptodate");
    expect(checkForAppUpdate).toHaveBeenCalledTimes(1);
  });
});
