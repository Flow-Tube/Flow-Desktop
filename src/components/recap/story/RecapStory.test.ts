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

  it("stays on the first page without restarting its clock when stepped back", () => {
    press("ArrowLeft");
    expect(dialog().textContent).toContain("Page 1 of 3");
    expect(dialog().querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toBe("Page 1 of 3");
  });

  it("jumps to a page from its segment", () => {
    const segments = dialog().querySelectorAll<HTMLButtonElement>('button[aria-label^="Page "]');
    expect(segments).toHaveLength(3);
    act(() => segments[1]!.click());
    expect(dialog().textContent).toContain("Your top channel");
  });

  describe("with the clock running", () => {
    let frames: FrameRequestCallback[] = [];
    let now = 0;
    const run = (ms: number) =>
      act(() => {
        const end = now + ms;
        while (now < end) {
          now += 50;
          const pending = frames;
          frames = [];
          pending.forEach((frame) => frame(now));
        }
      });

    beforeEach(() => {
      act(() => root.unmount());
      frames = [];
      now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
      vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
      root = createRoot(host);
      act(() => root.render(createElement(RecapStory, { summary, period: "2026-09", onClose })));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("fills the current page's segment as its time passes", () => {
      const bar = () => dialog().querySelector<HTMLElement>('[aria-current="step"] div')!;
      // A Tailwind scale class sets `scale`, which multiplies with the `transform` the clock writes.
      expect(bar().className).not.toMatch(/\bscale-/);
      run(3_250);
      expect(Number(bar().style.transform.match(/scaleX\((.+)\)/)?.[1])).toBeCloseTo(0.5, 1);
    });

    it("plays through by itself, then offers to play again", () => {
      run(7_000);
      expect(dialog().textContent).toContain("Page 2 of 3");
      run(7_000);
      expect(dialog().textContent).toContain("Page 3 of 3");
      expect(dialog().querySelector('[aria-label="Pause"]')).not.toBeNull();
      run(7_000);
      expect(dialog().querySelector('[aria-label="Play again"]')).not.toBeNull();

      press(" ");
      expect(dialog().textContent).toContain("Page 1 of 3");
      expect(dialog().querySelector('[aria-label="Pause"]')).not.toBeNull();
      run(7_000);
      expect(dialog().textContent).toContain("Page 2 of 3");
    });

    it("stops the clock while paused and while the window is in the background", () => {
      press(" ");
      run(20_000);
      expect(dialog().textContent).toContain("Page 1 of 3");
      press(" ");

      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      run(20_000);
      expect(dialog().textContent).toContain("Page 1 of 3");

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      run(7_000);
      expect(dialog().textContent).toContain("Page 2 of 3");
    });
  });
});
