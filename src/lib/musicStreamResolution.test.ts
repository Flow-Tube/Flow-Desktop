import { afterEach, describe, expect, it, vi } from "vitest";

import type { MusicStreamInfo } from "../types/music";

const { getMusicStream } = vi.hoisted(() => ({ getMusicStream: vi.fn() }));
vi.mock("./api/music", () => ({ getMusicStream }));

import { invalidateMusicStream, resolveMusicStream } from "./musicStreamResolution";

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

  it("serves a recent link from cache", async () => {
    getMusicStream.mockResolvedValueOnce(info("http://cached"));
    await resolveMusicStream("cached-song", "Auto");
    await resolveMusicStream("cached-song", "Auto");
    expect(getMusicStream).toHaveBeenCalledTimes(1);
  });
});
