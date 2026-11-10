import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LyricsEntry, LyricsProvider } from "./types";

const providers: LyricsProvider[] = [];

vi.mock("./registry", () => ({
  getEnabledProviders: () => providers,
  getOrderedProviders: () => providers,
  parseProviderEnabledStates: () => ({}),
}));
vi.mock("../../store/useAppSettingsStore", () => ({ getSettingValue: () => "" }));

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("../api/lyrics", () => ({
  getCachedLyrics: async (id: string) => disk.get(id) ?? null,
  putCachedLyrics: async (id: string, entries: string) => {
    disk.set(id, entries);
  },
  evictCachedLyrics: async (id: string) => {
    disk.delete(id);
  },
}));

const { applyManualLyrics, getLyrics, forceRefresh } = await import("./lyricsHelper");
const { resetLookupMemory } = await import("./lookupMemory");
const { seedOfflineLyrics } = await import("./offline");

const lineSynced: LyricsEntry[] = Array.from({ length: 6 }, (_, i) => ({ time: 1000 + i * 4000, text: `Line ${i}` }));
const wordSynced: LyricsEntry[] = lineSynced.map((line) => ({
  ...line,
  words: [
    { text: "Line", startTime: line.time, endTime: line.time + 500 },
    { text: "x", startTime: line.time + 500, endTime: line.time + 1500 },
  ],
}));
const plain: LyricsEntry[] = [{ time: 0, text: "Just words" }];

function provider(name: string, answer: () => Promise<LyricsEntry[]>): LyricsProvider & { calls: number } {
  const p = {
    name,
    calls: 0,
    getLyrics: () => {
      p.calls++;
      return answer();
    },
  };
  return p;
}

let id = 0;
const request = () => ({ videoId: `video-${++id}`, title: "Song", artist: "Band", durationSec: 200 });

beforeEach(() => {
  providers.length = 0;
  disk.clear();
  localStorage.clear();
  resetLookupMemory();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lyrics helper", () => {
  it("drops KuGou's instrumental notice saved in the disk cache", async () => {
    const song = request();
    disk.set(song.videoId, JSON.stringify([{ time: 1580, text: "纯音乐，请欣赏" }]));
    expect(await getLyrics(song)).toBeNull();
    expect(disk.has(song.videoId)).toBe(false);
  });

  it("shows saved line-synced lyrics at once while it looks for word sync, at most weekly", async () => {
    const song = request();
    disk.set(song.videoId, JSON.stringify({ provider: "LrcLib", entries: lineSynced }));
    const words = provider("Words", async () => wordSynced);
    providers.push(words);
    const shown: string[] = [];
    const result = await getLyrics(song, undefined, (answer) => shown.push(answer.provider));
    expect(shown).toEqual(["LrcLib", "Words"]);
    expect(result?.provider).toBe("Words");

    const quiet = request();
    disk.set(quiet.videoId, JSON.stringify(lineSynced));
    const nothing = provider("Nothing", async () => []);
    providers.length = 0;
    providers.push(nothing);
    // Lyrics saved before the source was kept show without one.
    expect((await getLyrics(quiet))?.provider).toBe("");
    expect(nothing.calls).toBe(1);
    // A fresh session has nothing in memory, so only the note can spare the sources.
    const { clearMemory } = await import("./cache");
    clearMemory();
    expect((await getLyrics(quiet))?.provider).toBe("");
    expect(nothing.calls).toBe(1);
  });

  it("returns word sync at once and leaves sources not yet started alone", async () => {
    const third = provider("Third", async () => lineSynced);
    providers.push(provider("Words", async () => wordSynced), provider("Lines", async () => lineSynced), third);
    const result = await getLyrics(request());
    expect(result?.provider).toBe("Words");
    expect(third.calls).toBe(0);
  });

  it("asks the first two sources together", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<LyricsEntry[]>(() => {});
    const first = provider("First", never);
    const second = provider("Second", never);
    const third = provider("Third", never);
    providers.push(first, second, third);
    void getLyrics(request());
    await vi.advanceTimersByTimeAsync(100);
    expect([first.calls, second.calls, third.calls]).toEqual([1, 1, 0]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(third.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
  });

  it("gives up at 9 s with what it has", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<LyricsEntry[]>(() => {});
    providers.push(provider("Plain", async () => plain), provider("Slow", never), provider("Slower", never));
    const pending = getLyrics(request());
    await vi.advanceTimersByTimeAsync(9_100);
    expect((await pending)?.provider).toBe("Plain");
  });

  it("prefers synced lyrics over an earlier plain answer", async () => {
    providers.push(provider("Plain", async () => plain), provider("Lines", async () => lineSynced));
    expect((await getLyrics(request()))?.provider).toBe("Lines");
  });

  it("remembers for a week that every source had nothing, and Refresh forgets it", async () => {
    const nothing = provider("Nothing", async () => []);
    providers.push(nothing);
    const req = request();
    expect(await getLyrics(req)).toBeNull();
    expect(await getLyrics(req)).toBeNull();
    expect(nothing.calls).toBe(1);
    forceRefresh(req.videoId);
    await getLyrics(req);
    expect(nothing.calls).toBe(2);
  });

  it("doesn't take a failure for having no lyrics", async () => {
    const down = provider("Down", async () => {
      throw new Error("HTTP 500");
    });
    providers.push(down, provider("Nothing", async () => []));
    const req = request();
    expect(await getLyrics(req)).toBeNull();
    expect(await getLyrics(req)).toBeNull();
    expect(down.calls).toBe(2);
  });

  it("keeps a hand pick, even when a better answer exists", async () => {
    const req = request();
    applyManualLyrics(req.videoId, lineSynced, "LrcLib");
    const words = provider("Words", async () => wordSynced);
    providers.push(words);
    const { clearMemory } = await import("./cache");
    clearMemory();
    await new Promise((resolve) => setTimeout(resolve));
    expect((await getLyrics(req))?.provider).toBe("LrcLib");
    expect(words.calls).toBe(0);
  });

  it("gives an answer to a caller joining a run already under way", async () => {
    let release: (value: LyricsEntry[]) => void = () => {};
    const req = request();
    disk.set(req.videoId, JSON.stringify(lineSynced));
    providers.push(provider("Slow", () => new Promise((resolve) => (release = resolve))));
    const first = getLyrics(req);
    await new Promise((resolve) => setTimeout(resolve));
    const shown: string[] = [];
    const second = getLyrics(req, undefined, (answer) => shown.push(answer.provider));
    expect(shown).toEqual([""]);
    release([]);
    await Promise.all([first, second]);
  });

  it("benches a provider that refuses the client, but not one that misses a song", async () => {
    const refused = provider("Refused", async () => {
      throw new Error("HTTP 403");
    });
    const missing = provider("Missing", async () => []);
    providers.push(refused, missing, provider("Lines", async () => lineSynced));
    await getLyrics(request());
    await getLyrics(request());
    expect(refused.calls).toBe(1);
    expect(missing.calls).toBe(2);
    forceRefresh("unused");
  });

  it("runs the chain once for callers asking for the same song together", async () => {
    const only = provider("Only", async () => wordSynced);
    providers.push(only);
    const req = request();
    const [a, b] = await Promise.all([getLyrics(req), getLyrics(req)]);
    expect(a).toEqual(b);
    expect(only.calls).toBe(1);
  });

  it("answers from memory the second time", async () => {
    const only = provider("Only", async () => wordSynced);
    providers.push(only);
    const req = request();
    await getLyrics(req);
    expect((await getLyrics(req))?.provider).toBe("Only");
    expect(only.calls).toBe(1);
  });

  it("starts no more sources once its only caller leaves", async () => {
    const never = () => new Promise<LyricsEntry[]>(() => {});
    const third = provider("Third", async () => wordSynced);
    providers.push(provider("First", never), provider("Second", never), third);
    const controller = new AbortController();
    const pending = getLyrics(request(), controller.signal);
    await new Promise((resolve) => setTimeout(resolve));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(third.calls).toBe(0);
  });

  it("falls back to the lyrics saved with a download", async () => {
    providers.push(provider("Nothing", async () => []));
    const req = request();
    seedOfflineLyrics(req.videoId, "[00:01.00]One\n[00:20.00]Two");
    const result = await getLyrics(req);
    expect(result?.provider).toBe("Downloaded");
    expect(result?.entries.map((e) => e.time)).toEqual([1000, 20000]);
  });
});
