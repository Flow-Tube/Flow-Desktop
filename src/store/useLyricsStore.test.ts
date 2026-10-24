import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LyricsResult } from "../lib/lyrics/types";

let answer: () => Promise<LyricsResult | null> = async () => null;

vi.mock("../lib/lyrics/lyricsHelper", () => ({
  getLyrics: () => answer(),
  forceRefresh: () => {},
  getAllLyrics: async () => {},
  applyManualLyrics: () => {},
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

describe("lyrics session", () => {
  it("clamps the sync offset to half a minute either way and resets it for the next song", () => {
    answer = () => new Promise(() => {});
    useLyricsStore.getState().load(request());
    for (let i = 0; i < 80; i++) useLyricsStore.getState().adjustSyncOffset(500);
    expect(useLyricsStore.getState().syncOffsetMs).toBe(30_000);
    useLyricsStore.getState().adjustSyncOffset(-100);
    expect(useLyricsStore.getState().syncOffsetMs).toBe(29_900);
    useLyricsStore.getState().load(request());
    expect(useLyricsStore.getState().syncOffsetMs).toBe(0);
  });

  it("shows a chosen source at once and starts its timing from zero, while an edit keeps it", () => {
    answer = () => new Promise(() => {});
    useLyricsStore.getState().load(request());
    useLyricsStore.getState().adjustSyncOffset(500);
    useLyricsStore.getState().applyEdited(timed);
    expect(useLyricsStore.getState().syncOffsetMs).toBe(500);
    expect(useLyricsStore.getState().isSynced).toBe(true);
    useLyricsStore.getState().applyCandidate({ providerName: "LrcLib", entries: [{ time: 0, text: "Plain" }], synced: false });
    expect(useLyricsStore.getState().providerName).toBe("LrcLib");
    expect(useLyricsStore.getState().syncOffsetMs).toBe(0);
    expect(useLyricsStore.getState().plain).toBe("Plain");
  });
});
