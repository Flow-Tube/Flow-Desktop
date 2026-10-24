import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LyricsEntry, LyricsProvider } from "./types";

const providers: LyricsProvider[] = [];

vi.mock("./registry", () => ({
  getEnabledProviders: () => providers,
  parseProviderEnabledStates: () => ({}),
}));
vi.mock("../../store/useAppSettingsStore", () => ({ getSettingValue: () => "" }));

const { getLyrics, forceRefresh } = await import("./lyricsHelper");
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
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lyrics helper", () => {
  it("returns word sync at once without asking later providers", async () => {
    const later = provider("Later", async () => lineSynced);
    providers.push(provider("Words", async () => wordSynced), later);
    const result = await getLyrics(request());
    expect(result?.provider).toBe("Words");
    expect(later.calls).toBe(0);
  });

  it("keeps a line-synced hit and lets a later provider beat it with word sync", async () => {
    providers.push(provider("Lines", async () => lineSynced), provider("Words", async () => wordSynced));
    const result = await getLyrics(request());
    expect(result?.provider).toBe("Words");
  });

  it("gives later providers only the word-sync grace after a line-synced hit", async () => {
    vi.useFakeTimers();
    const slow = provider("Slow", () => new Promise((resolve) => setTimeout(() => resolve(wordSynced), 6000)));
    const never = provider("Never", async () => wordSynced);
    providers.push(provider("Lines", async () => lineSynced), slow, never);
    const pending = getLyrics(request());
    await vi.advanceTimersByTimeAsync(4100);
    const result = await pending;
    expect(result?.provider).toBe("Lines");
    expect(result?.entries.every((e) => !e.words)).toBe(true);
    expect(never.calls).toBe(0);
  });

  it("prefers synced lyrics over an earlier plain answer", async () => {
    providers.push(provider("Plain", async () => plain), provider("Lines", async () => lineSynced));
    expect((await getLyrics(request()))?.provider).toBe("Lines");
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
    expect((await getLyrics(req))?.provider).toBe("MemoryCache");
    expect(only.calls).toBe(1);
  });

  it("stops between providers once its only caller leaves", async () => {
    let release: (value: LyricsEntry[]) => void = () => {};
    const first = provider("First", () => new Promise((resolve) => (release = resolve)));
    const second = provider("Second", async () => wordSynced);
    providers.push(first, second);
    const controller = new AbortController();
    const pending = getLyrics(request(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    release([]);
    await Promise.resolve();
    expect(second.calls).toBe(0);
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
