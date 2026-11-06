import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecapSummary } from "../../../lib/api/recap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const save = vi.fn();
const copy = vi.fn();
vi.mock("../../../lib/recap/useRecapPoster", () => ({
  useRecapPoster: () => ({ previewUrl: "blob:poster", failed: false, save, copy }),
}));
vi.mock("../../../lib/useChannelAvatar", () => ({ useChannelAvatar: () => null }));
vi.mock("../../../lib/useProxiedImageUrl", () => ({ useProxiedImageUrl: (src?: string) => src }));

const { RecapStory } = await import("./RecapStory");

const summary = {
  video: {
    views: 4,
    topChannels: [{ id: "UCc", name: "A channel", count: 4, durationMs: 60_000, detail: "", imageUrl: "", kind: "CHANNEL" }],
    topVideos: [],
    topTopics: [],
    newTopics: [],
    discoveredChannels: [],
    dislikes: [],
    skippedVideos: [],
    formatMs: { LONG: 60_000 },
    sponsorSavedMs: 0,
    actions: {},
  },
  music: { plays: 0, topArtists: [], topTracks: [], discoveredArtists: [], skippedTracks: [], activity: { totalMs: 0 } },
  combined: { totalMs: 60_000, activeDays: 1, longestStreak: 1, hourCounts: [0], dayMs: {}, busiestDay: null },
  insights: [],
} as unknown as RecapSummary;

let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

const dialog = () => document.body.querySelector('[role="dialog"]')!;
const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  onClose.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(RecapStory, { summary, period: "2026-09", onClose })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("RecapStory", () => {
  it("opens on the intro, over the whole window", () => {
    expect(dialog().textContent).toContain("Your September 2026 in Flow");
    expect(dialog().textContent).toContain("Page 1 of 3");
    expect(dialog().className).toContain("fixed inset-0");
  });

  it("steps with the arrow keys and stays inside the story", () => {
    press("ArrowLeft");
    expect(dialog().textContent).toContain("Page 1 of 3");
    press("ArrowRight");
    expect(dialog().textContent).toContain("Your top channel");
    press("ArrowRight");
    press("ArrowRight");
    expect(dialog().textContent).toContain("Page 3 of 3");
  });

  it("pauses with space and closes with Esc", () => {
    expect(dialog().querySelector('[aria-label="Pause"]')).not.toBeNull();
    press(" ");
    expect(dialog().querySelector('[aria-label="Play"]')).not.toBeNull();
    press("Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ends on the poster with its save and copy actions", () => {
    press("ArrowRight");
    press("ArrowRight");
    const buttons = [...dialog().querySelectorAll("button")];
    const named = (name: string) => buttons.find((button) => button.textContent === name)!;
    act(() => named("Save image").click());
    act(() => named("Copy image").click());
    expect(save).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
    expect(dialog().querySelector("img")?.getAttribute("src")).toBe("blob:poster");
  });
});
