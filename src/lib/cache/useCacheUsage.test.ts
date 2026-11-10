import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCacheUsage = vi.fn();
const clearCache = vi.fn();
const setCacheLimit = vi.fn();
const clearMemory = vi.fn();
vi.mock("../api/cache", () => ({
  getCacheUsage: () => getCacheUsage(),
  clearCache: (...args: unknown[]) => clearCache(...args),
  setCacheLimit: (...args: unknown[]) => setCacheLimit(...args),
}));
vi.mock("../lyrics/cache", () => ({ clearMemory: () => clearMemory() }));

import { useCacheUsage } from "./useCacheUsage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const usage = (limitMb = 500, bytes = 1024) => ({
  rows: [{ kind: "artwork", bytes, limitMb }],
  artworkClearPending: false,
});

async function mount() {
  const result: { current: ReturnType<typeof useCacheUsage> | null } = { current: null };
  const Probe = () => {
    result.current = useCacheUsage();
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  return result as { current: ReturnType<typeof useCacheUsage> };
}

describe("useCacheUsage", () => {
  beforeEach(() => {
    getCacheUsage.mockReset();
    clearCache.mockReset();
    setCacheLimit.mockReset();
    clearMemory.mockReset();
  });

  it("reads the sizes, and stays empty if they can't be read", async () => {
    getCacheUsage.mockResolvedValue(usage());
    expect((await mount()).current.usage?.rows[0]?.bytes).toBe(1024);
    getCacheUsage.mockRejectedValue(new Error("no backend"));
    expect((await mount()).current.usage).toBeNull();
  });

  it("measures again after a clear", async () => {
    getCacheUsage.mockResolvedValue(usage());
    clearCache.mockResolvedValue(undefined);
    const hook = await mount();
    getCacheUsage.mockResolvedValue(usage(500, 0));
    let cleared;
    await act(async () => {
      cleared = await hook.current.clear("artwork");
    });
    expect(cleared).toBe(true);
    expect(hook.current.usage?.rows[0]?.bytes).toBe(0);
    expect(clearMemory).not.toHaveBeenCalled();
  });

  it("forgets lyrics held in memory too", async () => {
    getCacheUsage.mockResolvedValue(usage());
    clearCache.mockResolvedValue(undefined);
    const hook = await mount();
    await act(async () => {
      await hook.current.clear("lyrics");
    });
    expect(clearMemory).toHaveBeenCalledTimes(1);
  });

  it("says when a clear fails", async () => {
    getCacheUsage.mockResolvedValue(usage());
    clearCache.mockRejectedValue(new Error("locked"));
    const hook = await mount();
    let cleared;
    await act(async () => {
      cleared = await hook.current.clear("network");
    });
    expect(cleared).toBe(false);
    expect(hook.current.busy).toBeNull();
  });

  it("rolls a limit back when it can't be saved", async () => {
    getCacheUsage.mockResolvedValue(usage(500));
    setCacheLimit.mockRejectedValue(new Error("read-only"));
    const hook = await mount();
    let saved;
    await act(async () => {
      saved = await hook.current.changeLimit("artwork", 100);
    });
    expect(saved).toBe(false);
    expect(hook.current.usage?.rows[0]?.limitMb).toBe(500);
  });

  it("keeps a saved limit", async () => {
    getCacheUsage.mockResolvedValue(usage(500));
    setCacheLimit.mockResolvedValue(undefined);
    const hook = await mount();
    getCacheUsage.mockResolvedValue(usage(100));
    await act(async () => {
      await hook.current.changeLimit("artwork", 100);
    });
    expect(setCacheLimit).toHaveBeenCalledWith("artwork", 100);
    expect(hook.current.usage?.rows[0]?.limitMb).toBe(100);
  });
});
