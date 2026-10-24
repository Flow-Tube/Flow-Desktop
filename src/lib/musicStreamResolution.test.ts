import { afterEach, describe, expect, it, vi } from "vitest";

import type { MusicStreamInfo } from "../types/music";

const { getMusicStream } = vi.hoisted(() => ({ getMusicStream: vi.fn() }));
vi.mock("./api/music", () => ({ getMusicStream }));

import { invalidateMusicStream, isResolveTimeout, resolveMusicStream } from "./musicStreamResolution";

const info = (url: string) => ({ videoId: "v", audioUrl: url }) as MusicStreamInfo;

afterEach(() => {
  vi.useRealTimers();
  getMusicStream.mockReset();
});

describe("music stream resolution", () => {
  it("gives up on a lookup that never answers", async () => {
    vi.useFakeTimers();
    getMusicStream.mockReturnValue(new Promise(() => {}));
    const pending = resolveMusicStream("hung", "Auto");
    const assertion = expect(pending).rejects.toMatchObject({ kind: "streaming" });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("does not cache a link that was invalidated while it resolved", async () => {
    let finish!: (value: MusicStreamInfo) => void;
    getMusicStream.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const stale = resolveMusicStream("song", "Auto");
    invalidateMusicStream("song");
    finish(info("http://stale"));
    await stale;

    getMusicStream.mockResolvedValueOnce(info("http://fresh"));
    await expect(resolveMusicStream("song", "Auto")).resolves.toMatchObject({ audioUrl: "http://fresh" });
  });

  it("lets a retry after a timeout join the walk still running", async () => {
    vi.useFakeTimers();
    let finish!: (value: MusicStreamInfo) => void;
    getMusicStream.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = resolveMusicStream("slow", "Auto");
    const timedOut = expect(first).rejects.toSatisfy(isResolveTimeout);
    await vi.advanceTimersByTimeAsync(15_000);
    await timedOut;

    const retry = resolveMusicStream("slow", "Auto");
    finish(info("http://late"));
    await expect(retry).resolves.toMatchObject({ audioUrl: "http://late" });
    expect(getMusicStream).toHaveBeenCalledTimes(1);
  });

  it("looks AAC up separately from the default format", async () => {
    getMusicStream.mockResolvedValueOnce(info("http://opus")).mockResolvedValueOnce(info("http://aac"));
    await resolveMusicStream("both", "Auto");
    await expect(resolveMusicStream("both", "Auto", { preferAac: true })).resolves.toMatchObject({
      audioUrl: "http://aac",
    });
    expect(getMusicStream).toHaveBeenLastCalledWith("both", "Auto", true);
  });

  it("serves a recent link from cache", async () => {
    getMusicStream.mockResolvedValueOnce(info("http://cached"));
    await resolveMusicStream("cached-song", "Auto");
    await resolveMusicStream("cached-song", "Auto");
    expect(getMusicStream).toHaveBeenCalledTimes(1);
  });
});
