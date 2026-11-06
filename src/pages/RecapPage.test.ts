import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityPattern, RecapIndex, RecapSummary } from "../lib/api/recap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  getRecapIndex: vi.fn(),
  getRecapSummary: vi.fn(),
}));
vi.mock("../lib/api/recap", () => api);
vi.mock("../lib/recap/recapQueue", () => ({ flushRecapQueue: async () => {} }));
vi.mock("../lib/useChannelAvatar", () => ({ useChannelAvatar: () => null }));
vi.mock("../lib/useProxiedImageUrl", () => ({ useProxiedImageUrl: (src?: string) => src }));
vi.mock("../store/useMusicPlayerStore", () => ({ useMusicPlayerStore: () => vi.fn() }));
vi.mock("../lib/recap/useRecapPoster", () => ({
  useRecapPoster: () => ({ previewUrl: null, failed: false, save: vi.fn(), copy: vi.fn() }),
}));

const { default: RecapPage } = await import("./RecapPage");

const pattern = (totalMs: number): ActivityPattern => ({
  totalMs,
  dayMs: totalMs ? ({ "2026-09-03": totalMs } as Record<string, number>) : {},
  hourCounts: Array.from({ length: 24 }, (_, hour) => (hour === 21 && totalMs ? 1 : 0)),
  weekdayCounts: [0, 0, 0, totalMs ? 1 : 0, 0, 0, 0],
  activeDays: totalMs ? 1 : 0,
  longestStreak: totalMs ? 1 : 0,
  busiestDay: totalMs ? ["2026-09-03", totalMs] : null,
});

function summary(overrides: { videoMs?: number; musicMs?: number; estimated?: boolean } = {}): RecapSummary {
  const videoMs = overrides.videoMs ?? 0;
  const musicMs = overrides.musicMs ?? 0;
  return {
    video: {
      views: videoMs ? 1 : 0,
      sessions: 1,
      activity: pattern(videoMs),
      formatMs: videoMs ? { LONG: videoMs } : {},
      topChannels: videoMs
        ? [{ id: "UCc", name: "A channel", count: 1, durationMs: 0, detail: "", imageUrl: "", kind: "CHANNEL" }]
        : [],
      topVideos: [],
      topTopics: [],
      newTopics: [],
      discoveredChannels: [],
      skippedVideos: [],
      dislikes: [],
      actions: {},
      topQueries: [],
      sponsorSkippedMs: videoMs ? { sponsor: 120_000 } : {},
      sponsorSavedMs: videoMs ? 120_000 : 0,
    },
    music: {
      plays: musicMs ? 1 : 0,
      sessions: 1,
      activity: pattern(musicMs),
      topArtists: musicMs
        ? [{ id: "UCa", name: "An artist", count: 1, durationMs: 0, detail: "", imageUrl: "", kind: "ARTIST" }]
        : [],
      topTracks: [],
      discoveredArtists: [],
      skippedTracks: [],
      dislikedArtists: [],
      blockedArtists: [],
    },
    combined: pattern(videoMs + musicMs),
    previousTotalMs: null,
    insights: videoMs ? ["NIGHT_OWL"] : [],
    estimated: overrides.estimated ?? false,
  };
}

const index = (months: [string, number][] = [["2026-09", 3]]): RecapIndex => ({ startedAt: 1, months, historyChannels: [] });

let host: HTMLDivElement;
let root: Root;

async function open(entry = "/recap") {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(RecapPage, { onPlay: () => {} })));
  });
}

beforeEach(() => {
  api.getRecapIndex.mockReset();
  api.getRecapSummary.mockReset();
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("RecapPage", () => {
  it("explains itself when the ledger is empty", async () => {
    api.getRecapIndex.mockResolvedValue(index([]));
    await open();
    expect(host.textContent).toContain("Your recap starts now");
    expect(api.getRecapSummary).not.toHaveBeenCalled();
  });

  it("offers a retry when the ledger can't be read, and recovers", async () => {
    api.getRecapIndex.mockRejectedValueOnce(new Error("down"));
    await open();
    expect(host.textContent).toContain("Couldn't open your recap");
    api.getRecapIndex.mockResolvedValue(index([]));
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(host.textContent).toContain("Your recap starts now");
  });

  it("says so when a month has nothing in it", async () => {
    api.getRecapIndex.mockResolvedValue(index());
    api.getRecapSummary.mockResolvedValue(summary());
    await open();
    expect(host.textContent).toContain("Nothing recorded for this period");
  });

  it("opens on the newest month with its cards, insight and SponsorBlock time", async () => {
    api.getRecapIndex.mockResolvedValue(index([["2026-09", 3], ["2026-08", 1]]));
    api.getRecapSummary.mockResolvedValue(summary({ videoMs: 3_600_000, musicMs: 60_000 }));
    await open();
    expect(api.getRecapSummary).toHaveBeenCalledWith("2026-09", "ALL");
    for (const text of ["1 h 1 min", "A channel", "An artist", "Night owl", "Time SponsorBlock saved you", "Your calendar"]) {
      expect(host.textContent).toContain(text);
    }
  });

  it("opens on a period from the link, and hides the other source's lists", async () => {
    api.getRecapIndex.mockResolvedValue(index());
    api.getRecapSummary.mockResolvedValue(summary({ videoMs: 3_600_000, musicMs: 60_000 }));
    localStorage.setItem("flow_recap_source", "VIDEO");
    await open("/recap?period=2026");
    expect(api.getRecapSummary).toHaveBeenCalledWith("2026", "VIDEO");
    expect(host.textContent).toContain("A channel");
    expect(host.textContent).not.toContain("An artist");
    expect(host.textContent).not.toContain("Your calendar");
  });

  it("plays a month or a year as a story, but not all time", async () => {
    api.getRecapIndex.mockResolvedValue(index());
    api.getRecapSummary.mockResolvedValue(summary({ videoMs: 60_000 }));
    await open();
    const play = [...host.querySelectorAll("button")].find((button) => button.textContent === "Play your recap")!;
    await act(async () => play.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("in Flow");
    await act(async () => root.unmount());
    root = createRoot(host);
    await open("/recap?period=all");
    expect(host.textContent).not.toContain("Play your recap");
  });

  it("labels a period holding an estimate", async () => {
    api.getRecapIndex.mockResolvedValue(index());
    api.getRecapSummary.mockResolvedValue(summary({ videoMs: 60_000, estimated: true }));
    await open();
    expect(host.textContent).toContain("rough estimate");
  });
});
