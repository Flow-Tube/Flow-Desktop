import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamInfo } from "../types/video";

function makeInfo(id: string): StreamInfo {
  return {
    streamId: id,
    localUrl: `http://127.0.0.1:9/stream/${id}`,
    expiresAt: "",
    variants: [],
    captions: [],
    audioTracks: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.doUnmock("./api/youtube");
  vi.resetModules();
  vi.useRealTimers();
});

async function loadModule(getStreamInfo: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock("./api/youtube", () => ({ getStreamInfo }));
  return import("./streamResolution");
}

describe("resolveStreamInfo", () => {
  it("joins an in-flight request instead of opening a second one", async () => {
    const getStreamInfo = vi.fn().mockResolvedValue(makeInfo("a"));
    const mod = await loadModule(getStreamInfo);

    const [first, second] = await Promise.all([
      mod.resolveStreamInfo("a"),
      mod.resolveStreamInfo("a"),
    ]);

    expect(getStreamInfo).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("serves a resolved video from cache until it is invalidated", async () => {
    const getStreamInfo = vi.fn().mockResolvedValue(makeInfo("a"));
    const mod = await loadModule(getStreamInfo);

    await mod.resolveStreamInfo("a");
    await mod.resolveStreamInfo("a");
    expect(getStreamInfo).toHaveBeenCalledTimes(1);

    mod.invalidateStreamInfo("a");
    await mod.resolveStreamInfo("a");
    expect(getStreamInfo).toHaveBeenCalledTimes(2);
  });

  it("walks a fresh ladder when a hard retry asks for one", async () => {
    const getStreamInfo = vi.fn().mockResolvedValue(makeInfo("a"));
    const mod = await loadModule(getStreamInfo);

    await mod.resolveStreamInfo("a");
    await mod.resolveStreamInfo("a", { refresh: true });

    expect(getStreamInfo).toHaveBeenCalledTimes(2);
    expect(getStreamInfo).toHaveBeenLastCalledWith("a", true);
  });

  it("keeps a timed-out request running so a retry gets its answer for free", async () => {
    vi.useFakeTimers();
    const pending = deferred<StreamInfo>();
    const getStreamInfo = vi.fn().mockReturnValue(pending.promise);
    const mod = await loadModule(getStreamInfo);

    const timedOut = mod.resolveStreamInfo("a", { timeoutMs: 1000 });
    const assertion = expect(timedOut).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;

    pending.resolve(makeInfo("a"));
    await vi.advanceTimersByTimeAsync(0);

    await expect(mod.resolveStreamInfo("a")).resolves.toEqual(makeInfo("a"));
    expect(getStreamInfo).toHaveBeenCalledTimes(1);
  });
});

describe("prefetchStreamInfo", () => {
  it("runs at most two speculative resolves at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const getStreamInfo = vi.fn().mockImplementation(
      () =>
        new Promise<StreamInfo>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          setTimeout(() => {
            active -= 1;
            resolve(makeInfo("x"));
          }, 5);
        }),
    );
    const mod = await loadModule(getStreamInfo);

    for (const id of ["a", "b", "c", "d"]) mod.prefetchStreamInfo(id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("is free for a video the player then asks for", async () => {
    const getStreamInfo = vi.fn().mockResolvedValue(makeInfo("a"));
    const mod = await loadModule(getStreamInfo);

    mod.prefetchStreamInfo("a");
    await mod.resolveStreamInfo("a");

    expect(getStreamInfo).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed prefetch and lets the real resolve report the error", async () => {
    const getStreamInfo = vi.fn().mockRejectedValue(new Error("age-restricted"));
    const mod = await loadModule(getStreamInfo);

    mod.prefetchStreamInfo("a");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(mod.resolveStreamInfo("a")).rejects.toThrow(/age-restricted/);
  });
});
