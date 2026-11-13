// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../../../types/music";
import source from "./LyricsShareDialog.tsx?raw";

const copy = vi.fn();
const save = vi.fn(async () => {});
const imageArgs = vi.fn();

vi.mock("../../../lib/audio/musicAudioEngine", () => ({ musicAudioEngine: { getCurrentTime: () => 3.5 } }));
vi.mock("../../../lib/lyrics/useLyricCard", () => ({
  useLyricCardArtwork: () => ({
    art: null,
    styles: [
      { id: "artwork", ground: { r: 30, g: 60, b: 40 }, ink: { r: 255, g: 255, b: 255 } },
      { id: "surface", ground: { r: 40, g: 40, b: 40 }, ink: { r: 240, g: 240, b: 240 } },
    ],
  }),
  useLyricCardImage: (...args: unknown[]) => {
    imageArgs(...args);
    return { previewUrl: args[0] ? "blob:card" : null, rendering: false, copy, save };
  },
}));

const { LyricsShareDialog } = await import("./LyricsShareDialog");
const { useLyricsStore } = await import("../../../store/useLyricsStore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = { id: "song-1", title: "Test Song", artists: [{ name: "Test Artist", id: "a1" }], thumbnail: "" } as unknown as SongItem;

let root: Root;
const host = document.createElement("div");
const buttons = () => [...document.querySelectorAll("button")];
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
const lineButtons = () => buttons().filter((b) => b.hasAttribute("aria-pressed"));
const click = (element: Element | undefined) => act(() => (element as HTMLElement).click());

beforeEach(() => {
  useLyricsStore.setState({
    entries: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ time: n * 1000, text: `Line ${n}` })),
    plain: null,
    syncOffsetMs: 0,
  });
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(LyricsShareDialog, { track, onClose: vi.fn() })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("LyricsShareDialog", () => {
  it("starts with four lines from the one playing", () => {
    const pressed = lineButtons().filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.textContent)).toEqual(["Line 3", "Line 4", "Line 5", "Line 6"]);
    expect(document.body.textContent).toContain("4 of 5 lines selected");
  });

  it("stops at five lines", () => {
    click(lineButtons()[0]);
    const unselected = lineButtons().find((b) => b.getAttribute("aria-pressed") === "false")!;
    expect(unselected.disabled).toBe(true);
  });

  it("draws the chosen lines and copies inside the click", () => {
    click(button("Next"));
    const [data] = imageArgs.mock.calls[imageArgs.mock.calls.length - 1]!;
    expect(data).toEqual({ lines: ["Line 3", "Line 4", "Line 5", "Line 6"], title: "Test Song", artist: "Test Artist" });
    expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:card");

    click(button("Copy image"));
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("switches the card's look and alignment, and goes back to the lines", () => {
    click(button("Next"));
    click(document.querySelector('[aria-label="Surface"]')!);
    click(buttons().find((b) => b.textContent?.includes("Center")));
    const [, style, align] = imageArgs.mock.calls[imageArgs.mock.calls.length - 1]!;
    expect(style).toMatchObject({ id: "surface" });
    expect(align).toBe("center");

    click(button("Back"));
    expect(lineButtons()).toHaveLength(7);
  });
});

describe("LyricsShareDialog source", () => {
  it("keeps to Design.md: no hex colours, shadows, gradients or raw palette colours", () => {
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\bshadow-|bg-gradient-|\b(?:text|bg|ring)-(?:white|black)\b/);
  });
});
