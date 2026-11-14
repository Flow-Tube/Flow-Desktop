// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../../../types/music";
import source from "./LyricsShareDialog.tsx?raw";

const copy = vi.fn();
const copyLines = vi.fn();
const save = vi.fn(async () => {});
const imageArgs = vi.fn();

vi.mock("../../../lib/audio/musicAudioEngine", () => ({ musicAudioEngine: { getCurrentTime: () => 3.5 } }));
vi.mock("../../../lib/lyrics/useLyricCard", () => ({
  useLyricCardArtwork: () => ({
    art: null,
    colors: {
      styles: [
        { id: "artwork", ground: { r: 30, g: 60, b: 40 }, ink: { r: 255, g: 255, b: 255 } },
        { id: "surface", ground: { r: 40, g: 40, b: 40 }, ink: { r: 240, g: 240, b: 240 } },
      ],
      scheme: { inverseSurface: { r: 230, g: 230, b: 230 }, surfaceContainerHighest: { r: 40, g: 40, b: 40 } },
      accent: { r: 240, g: 120, b: 30 },
    },
  }),
  useLyricCardImage: (...args: unknown[]) => {
    imageArgs(...args);
    return { previewUrl: args[0] ? "blob:card" : null, rendering: false, copy, copyLines, save };
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
  act(() => root.render(createElement(LyricsShareDialog, { track, initialAlign: "center", onClose: vi.fn() })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const pick = (...texts: string[]) => {
  for (const text of texts) click(lineButtons().find((b) => b.textContent === text));
};
const lastLook = () => imageArgs.mock.calls[imageArgs.mock.calls.length - 1]![1];

describe("LyricsShareDialog", () => {
  it("starts with nothing picked, as on Android", () => {
    expect(lineButtons().filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(0);
    expect(document.body.textContent).toContain("0 of 5 lines selected");
    expect(button("Next")!.disabled).toBe(true);
  });

  it("stops at five lines", () => {
    pick("Line 1", "Line 2", "Line 3", "Line 4", "Line 5");
    expect(lineButtons().find((b) => b.textContent === "Line 6")!.disabled).toBe(true);
  });

  it("draws the picked lines in Android's default look, and copies inside the click", () => {
    pick("Line 4", "Line 2");
    click(button("Next"));
    const [data] = imageArgs.mock.calls[imageArgs.mock.calls.length - 1]!;
    expect(data).toEqual({ lines: ["Line 2", "Line 4"], title: "Test Song", artist: "Test Artist" });
    expect(lastLook()).toMatchObject({ style: { id: "artwork" }, align: "center", layout: "classic", aspect: "fit", frame: "square" });
    expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:card");

    click(button("Copy image"));
    expect(copy).toHaveBeenCalledTimes(1);
    click(button("Copy text"));
    expect(copyLines).toHaveBeenCalledTimes(1);
  });

  it("changes the colour, layout, size, edges and alignment, and keeps them when going back", () => {
    pick("Line 1");
    click(button("Next"));
    click(document.querySelector('[aria-label="Surface"]')!);
    click(button("Poster"));
    click(button("Story"));
    click(button("Framed"));
    click(button("Right"));
    expect(lastLook()).toMatchObject({ style: { id: "surface" }, layout: "poster", aspect: "story", frame: "backdrop", align: "right" });
    expect(lastLook().backdrop).toEqual({ r: 240, g: 120, b: 30 });

    click(button("Back"));
    expect(lineButtons()).toHaveLength(7);
    click(button("Next"));
    expect(lastLook()).toMatchObject({ layout: "poster", aspect: "story", frame: "backdrop" });
  });
});

describe("LyricsShareDialog source", () => {
  it("keeps to Design.md: no hex colours, shadows, gradients or raw palette colours", () => {
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\bshadow-|bg-gradient-|\b(?:text|bg|ring)-(?:white|black)\b/);
  });
});
