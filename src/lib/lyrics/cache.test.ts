import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();

vi.mock("../api/lyrics", () => ({
  getCachedLyrics: async (id: string) => disk.get(id) ?? null,
  putCachedLyrics: async (id: string, entries: string) => {
    disk.set(id, entries);
  },
  evictCachedLyrics: async (id: string) => {
    disk.delete(id);
  },
}));

beforeEach(() => {
  disk.clear();
  localStorage.clear();
  vi.resetModules();
});

describe("lyrics cache", () => {
  it("moves lyrics an earlier version kept in localStorage to app data, and deletes them", async () => {
    localStorage.setItem("flow_lyrics_dQw4w9WgXcQ", JSON.stringify([{ time: 0, text: "old" }]));
    localStorage.setItem("flow_lyrics_broken0000", "{not json");
    localStorage.setItem("other_setting", "kept");
    const cache = await import("./cache");
    expect(await cache.getDisk("dQw4w9WgXcQ")).toEqual({ entries: [{ time: 0, text: "old" }], provider: null });
    expect(localStorage.getItem("flow_lyrics_dQw4w9WgXcQ")).toBeNull();
    expect(localStorage.getItem("flow_lyrics_broken0000")).toBeNull();
    expect(localStorage.getItem("other_setting")).toBe("kept");
    expect(disk.has("broken0000")).toBe(false);
  });

  it("keeps only the 32 most recently used songs in memory", async () => {
    const cache = await import("./cache");
    for (let i = 0; i < 40; i++) cache.setMemory(`song${i}`, [{ time: 0, text: String(i) }], null);
    expect(cache.getMemory("song0")).toBeNull();
    expect(cache.getMemory("song39")).not.toBeNull();
    cache.getMemory("song8");
    cache.setMemory("song40", [], null);
    expect(cache.getMemory("song8")).not.toBeNull();
    expect(cache.getMemory("song9")).toBeNull();
  });

  it("writes and evicts on disk", async () => {
    const cache = await import("./cache");
    cache.setDisk("abc", [{ time: 1, text: "x" }], "LrcLib");
    await Promise.resolve();
    expect(await cache.getDisk("abc")).toEqual({ entries: [{ time: 1, text: "x" }], provider: "LrcLib" });
    cache.evict("abc");
    await Promise.resolve();
    expect(await cache.getDisk("abc")).toBeNull();
  });

  it("keeps where saved lyrics came from, and reads the lists earlier versions saved without one", async () => {
    disk.set("old", JSON.stringify([{ time: 2, text: "y" }]));
    const cache = await import("./cache");
    expect(await cache.getDisk("old")).toEqual({ entries: [{ time: 2, text: "y" }], provider: null });
    cache.setMemory("song", [{ time: 0, text: "z" }], "KuGou");
    expect(cache.getMemory("song")?.provider).toBe("KuGou");
  });
});
