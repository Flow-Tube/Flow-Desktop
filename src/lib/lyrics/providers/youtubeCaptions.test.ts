import { beforeEach, describe, expect, it, vi } from "vitest";

const getMusicCaptionsLrc = vi.fn();
vi.mock("../../api/lyrics", () => ({ getMusicCaptionsLrc: (...args: unknown[]) => getMusicCaptionsLrc(...args) }));

import { youtubeCaptionsProvider } from "./youtubeCaptions";
import type { CreditedLyrics } from "../types";

const lookup = async (id: string) => (await youtubeCaptionsProvider.getLyrics(id, "t", "a", 1)) as CreditedLyrics;

describe("youtubeCaptionsProvider", () => {
  beforeEach(() => {
    getMusicCaptionsLrc.mockReset();
  });

  it("turns captions into timed lines", async () => {
    getMusicCaptionsLrc.mockResolvedValue("[00:01.500]Hello\n[00:03.000]World");
    const { entries } = await lookup("abc");
    expect(entries.map((entry) => [entry.time, entry.text])).toEqual([[1500, "Hello"], [3000, "World"]]);
  });

  it("finds nothing without captions or an id", async () => {
    getMusicCaptionsLrc.mockResolvedValue(null);
    expect((await lookup("abc")).entries).toEqual([]);
    expect((await lookup("")).entries).toEqual([]);
  });
});
