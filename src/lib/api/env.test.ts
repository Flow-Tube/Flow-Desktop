import { afterEach, describe, expect, it, vi } from "vitest";

describe("isTauriEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers false when the page goes away while it waits for Tauri", async () => {
    vi.resetModules();
    const { isTauriEnv } = await import("./env");
    const pending = isTauriEnv();
    vi.stubGlobal("window", undefined);
    await expect(pending).resolves.toBe(false);
  });
});
