import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LyricsResult } from "../lib/lyrics/types";

let answer: () => Promise<LyricsResult | null> = async () => null;

vi.mock("../lib/lyrics/lyricsHelper", () => ({
  getLyrics: () => answer(),
  forceRefresh: () => {},
}));

const { useLyricsStore } = await import("./useLyricsStore");
const { seedOfflineLyrics } = await import("../lib/lyrics/offline");

let id = 0;
const request = () => ({ videoId: `song-${++id}`, title: "Song", artist: "Band", durationSec: 200 });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const timed = Array.from({ length: 6 }, (_, i) => `[00:${String(10 + i * 5).padStart(2, "0")}.00]Line ${i}`).join("\n");

beforeEach(() => {
  answer = async () => null;
  useLyricsStore.getState().clear();
});

describe("lyrics store", () => {
  it("shows saved lyrics at once, without a spinner", () => {
    const req = request();
    seedOfflineLyrics(req.videoId, timed);
    answer = () => new Promise(() => {});
    useLyricsStore.getState().load(req);
    const state = useLyricsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.isSynced).toBe(true);
    expect(state.providerName).toBe("Downloaded");
  });

  it("shows saved lyrics that arrive after the lookup started", () => {
    const req = request();
    answer = () => new Promise(() => {});
    useLyricsStore.getState().load(req);
    expect(useLyricsStore.getState().loading).toBe(true);
    seedOfflineLyrics(req.videoId, "Plain words");
    expect(useLyricsStore.getState().loading).toBe(false);
    expect(useLyricsStore.getState().plain).toBe("Plain words");
  });

  it("keeps saved synced lyrics over a plain provider result", async () => {
    const req = request();
    seedOfflineLyrics(req.videoId, timed);
    answer = async () => ({ entries: [{ time: 0, text: "Plain" }], provider: "YouTube" });
    useLyricsStore.getState().load(req);
    await flush();
    expect(useLyricsStore.getState().providerName).toBe("Downloaded");
  });

  it("ignores the answer for a song that is no longer current", async () => {
    let finish: (result: LyricsResult | null) => void = () => {};
    answer = () => new Promise((resolve) => (finish = resolve));
    useLyricsStore.getState().load(request());
    answer = () => new Promise(() => {});
    const second = request();
    useLyricsStore.getState().load(second);
    finish({ entries: [{ time: 0, text: "Old" }], provider: "Old" });
    await flush();
    expect(useLyricsStore.getState().videoId).toBe(second.videoId);
    expect(useLyricsStore.getState().providerName).toBe("");
  });
});
