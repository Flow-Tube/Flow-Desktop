import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import type { LyricsEntry } from "../../../lib/lyrics/types";

const audio = { time: 0, duration: 200 };
vi.mock("../../../lib/audio/musicAudioEngine", () => ({
  musicAudioEngine: { getCurrentTime: () => audio.time, getDuration: () => audio.duration },
}));
vi.mock("../../../lib/platform", () => ({ IS_LINUX_RUNTIME: false }));

const { LyricsPanel } = await import("./LyricsPanel");

const drawn: string[] = [];

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      direction: "ltr",
      fillStyle: "",
      shadowColor: "",
      shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      setTransform() {},
      clearRect() {},
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      translate() {},
      fillText: (text: string) => drawn.push(text),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const word = (text: string, start: number, end: number) => ({ text, startTime: start, endTime: end });
const lines: LyricsEntry[] = [
  { time: 1000, text: "first line", words: [word("first", 1000, 1500), word("line", 1500, 2500)] },
  { time: 3000, text: "second line", words: [word("second", 3000, 3600), word("line", 3600, 4500)] },
  { time: 5000, text: "third line", words: [word("third", 5000, 5600), word("line", 5600, 6500)] },
  { time: 7000, text: "fourth line", words: [word("fourth", 7000, 7600), word("line", 7600, 8500)] },
  { time: 20000, text: "after a break", words: [word("after", 20000, 20500), word("a", 20500, 20700), word("break", 20700, 21500)] },
];

let root: Root;
let host: HTMLDivElement;
const seeks: number[] = [];

function render(props: Partial<Parameters<typeof LyricsPanel>[0]> = {}) {
  act(() => {
    root.render(
      createElement(LyricsPanel, {
        lyrics: null,
        syncedLyrics: lines,
        isLoading: false,
        providerName: "BetterLyrics",
        accent: { r: 240, g: 240, b: 240 },
        backdrop: null,
        baseTextSize: 44,
        maxRowWidth: 1100,
        textAlign: "center",
        showTranslation: true,
        showRomanization: true,
        syncOffsetMs: 0,
        active: true,
        isPlaying: true,
        onSeekTo: (ms: number) => seeks.push(ms),
        resyncBottom: 24,
        ...props,
      }),
    );
  });
}

/**
 * Plays `ms` of the song: the audio clock moves with the timers, as a playing element's does, and
 * React renders between frames as it would in the app.
 */
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 16) {
    act(() => {
      audio.time += 0.016;
      vi.advanceTimersByTime(16);
    });
  }
};

const rows = () => Array.from(host.querySelectorAll<HTMLElement>("[data-lyric-row]"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  audio.time = 0;
  drawn.length = 0;
  seeks.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("lyrics panel", () => {
  it("lays out the lines and sings the current one on its canvas", () => {
    render();
    audio.time = 3.2;
    advance(400);
    advance(100);
    expect(rows().length).toBe(lines.length);
    expect(host.querySelectorAll("canvas").length).toBeGreaterThan(0);
    expect(drawn).toContain("second line");
    expect(host.querySelector("[aria-live=polite]")?.textContent).toBe("second line");
    const sung = rows()[1]!;
    advance(600);
    expect(sung.style.transform).toContain("scale(1.05)");
    expect(sung.style.opacity).toBe("1");
  });

  it("seeks to a line when it is clicked", () => {
    render();
    advance(200);
    act(() => rows()[2]!.click());
    expect(seeks).toEqual([5000]);
  });

  it("stops following the song on a wheel scroll and offers to resync", () => {
    render();
    audio.time = 3.2;
    advance(400);
    const resync = host.querySelector<HTMLButtonElement>("button[aria-label]")!;
    expect(resync.className).toContain("opacity-0");
    act(() => {
      host.querySelector(".touch-none")!.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
    });
    expect(host.querySelector<HTMLButtonElement>("button[aria-label]")!.className).toContain("opacity-100");
    advance(8100);
    expect(host.querySelector<HTMLButtonElement>("button[aria-label]")!.className).toContain("opacity-0");
  });

  it("shows plain lyrics without karaoke", () => {
    render({ syncedLyrics: [], lyrics: "one\ntwo\nthree" });
    advance(200);
    expect(rows().length).toBe(3);
    expect(host.querySelectorAll("canvas").length).toBe(0);
    expect(host.textContent).toContain("two");
  });

  it("redraws only the sung line each frame, and nothing once paused and settled", () => {
    render();
    audio.time = 3.2;
    advance(400);
    advance(1500);
    drawn.length = 0;
    advance(300);
    expect(drawn.length).toBeGreaterThan(5);
    expect(new Set(drawn)).toEqual(new Set(["third line"]));
    render({ isPlaying: false });
    act(() => vi.advanceTimersByTime(1500));
    drawn.length = 0;
    act(() => vi.advanceTimersByTime(1000));
    expect(drawn).toEqual([]);
  });

  it("puts duet singers on their own sides and shows a background vocal only with its line", () => {
    const duet: LyricsEntry[] = [
      { time: 1000, text: "first voice", agent: "v1", words: [word("first", 1000, 1500), word("voice", 1500, 2500)] },
      { time: 1600, text: "(ooh)", agent: "bg", isBackground: true, words: [word("(ooh)", 1600, 2400)] },
      { time: 9000, text: "second voice", agent: "v2", words: [word("second", 9000, 9500), word("voice", 9500, 10500)] },
      { time: 11000, text: "first again", agent: "v1", words: [word("first", 11000, 11500), word("again", 11500, 12500)] },
    ];
    render({ syncedLyrics: duet });
    advance(100);
    const origins = rows().map((r) => r.style.transformOrigin);
    expect(origins[0]).toBe("0% 50%");
    expect(origins.some((o) => o === "100% 50%")).toBe(true);
    const echoHeight = () => rows()[1]!.style.height;
    expect(echoHeight()).toBe("2px");
    audio.time = 1.5;
    advance(600);
    expect(Number.parseFloat(echoHeight())).toBeGreaterThan(20);
  });

  it("does nothing while hidden", () => {
    render({ active: false });
    drawn.length = 0;
    audio.time = 3.2;
    advance(1000);
    expect(drawn).toEqual([]);
  });
});
