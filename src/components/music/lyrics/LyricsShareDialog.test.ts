import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { SongItem } from "../../../types/music";
import { useLyricsStore } from "../../../store/useLyricsStore";
import { copyPng } from "../../../lib/clipboard";
import {
  autoSelectLyricIndices,
  isShareableLine,
  shareLineIndexAt,
} from "./LyricsShareDialog";

vi.mock("../../../lib/clipboard", () => ({
  copyPng: vi.fn(async () => true),
}));

vi.mock("../../../lib/api/files", () => ({
  savePngImage: vi.fn(async () => true),
}));

vi.mock("../../../lib/audio/musicAudioEngine", () => ({
  musicAudioEngine: {
    getCurrentTime: vi.fn(() => 2.5),
  },
}));

vi.mock("../../../lib/lyrics/palette", () => ({
  extractArtworkPalette: vi.fn(async () => [
    { id: "cover", label: "Cover", hex: "#121212", ground: "#121212", ink: "#ffffff", isCover: true, isLight: false },
    { id: "base", label: "Dominant", hex: "#1e293b", ground: "#1e293b", ink: "#ffffff", isLight: false },
    { id: "accent", label: "Vibrant", hex: "#f97316", ground: "#f97316", ink: "#ffffff", isLight: false },
    { id: "white", label: "White", hex: "#ffffff", ground: "#ffffff", ink: "#111111", isLight: true },
  ]),
  isLightColor: vi.fn((hex: string) => hex === "#ffffff"),
}));

vi.mock("../../../lib/lyrics/lyricCardRenderer", () => ({
  BASE_CARD_WIDTH: 340,
  BASE_CARD_HEIGHT: 460,
  EXPORT_SCALE: 2.5,
  CARD_WIDTH: 850,
  renderLyricCardBlob: vi.fn(async () => new Blob(["fake-png"], { type: "image/png" })),
}));

const { LyricsShareDialog } = await import("./LyricsShareDialog");

const track: SongItem = {
  id: "song-1",
  title: "Test Song",
  artists: [{ name: "Test Artist", id: "artist-1" }],
  album: null,
  duration: 180,
  musicVideoType: null,
  thumbnail: "https://example.com/cover.jpg",
  explicit: false,
  videoId: "song-1",
  playlistId: null,
  params: null,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  useLyricsStore.setState({
    entries: [
      { time: 1000, text: "Line one of lyrics" },
      { time: 2000, text: "Line two of lyrics" },
      { time: 3000, text: "Line three of lyrics" },
      { time: 4000, text: "Line four of lyrics" },
      { time: 5000, text: "Line five of lyrics" },
      { time: 6000, text: "Line six of lyrics" },
    ],
    plain: "",
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

describe("LyricsShareDialog selection logic", () => {
  it("filters non-shareable lines correctly", () => {
    expect(isShareableLine("")).toBe(false);
    expect(isShareableLine("   ")).toBe(false);
    expect(isShareableLine("[Verse 1]")).toBe(false);
    expect(isShareableLine("Valid lyric line")).toBe(true);
  });

  it("calculates current line index at playback position in milliseconds", () => {
    const entries = [
      { time: 500, text: "[Intro]" },
      { time: 1000, text: "First line" },
      { time: 3000, text: "Second line" },
      { time: 5000, text: "Third line" },
    ];

    expect(shareLineIndexAt(entries, 500)).toBe(0);
    expect(shareLineIndexAt(entries, 1200)).toBe(0);
    expect(shareLineIndexAt(entries, 3500)).toBe(1);
    expect(shareLineIndexAt(entries, 6000)).toBe(2);
  });

  it("auto-selects a cohesive stanza around playback position", () => {
    // Stanza starting at line 2 in a 10-line song
    expect(autoSelectLyricIndices(10, 2, 4)).toEqual([2, 3, 4, 5]);

    // Near the end of the song
    expect(autoSelectLyricIndices(10, 9, 4)).toEqual([6, 7, 8, 9]);

    // Short song
    expect(autoSelectLyricIndices(3, 1, 4)).toEqual([0, 1, 2]);
  });
});

describe("LyricsShareDialog Component", () => {
  it("renders selection step with auto-selected line buttons and Next button", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root?.render(createElement(LyricsShareDialog, { track, onClose }));
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    // Check lines list rendered
    const buttons = dialog?.querySelectorAll("button");
    const lineButtons = Array.from(buttons ?? []).filter((b) =>
      b.textContent?.includes("Line"),
    );
    expect(lineButtons.length).toBe(6);

    // Check Next button is present
    const nextBtn = Array.from(buttons ?? []).find((b) => b.textContent?.includes("Next"));
    expect(nextBtn).toBeDefined();
  });

  it("transitions between selection step and styling step with Flow logo in card", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root?.render(createElement(LyricsShareDialog, { track, onClose }));
    });

    const nextBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Next"),
    );
    expect(nextBtn).toBeDefined();

    // Click Next to enter style view
    await act(async () => {
      nextBtn?.click();
    });

    // Verify official Flow logo badge exists in preview
    const flowLogoSvg = document.querySelector('svg[aria-label="Flow"]');
    expect(flowLogoSvg).not.toBeNull();

    // Check style view elements: Copy image, Save image, and Back button
    const copyBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Copy image"),
    );
    expect(copyBtn).toBeDefined();

    const backBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Back",
    );
    expect(backBtn).toBeDefined();

    // Click Back to return to select view
    await act(async () => {
      backBtn?.click();
    });

    const lineButtons = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Line"),
    );
    expect(lineButtons.length).toBe(6);
  });

  it("calls copyPng when copy image button is clicked", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root?.render(createElement(LyricsShareDialog, { track, onClose }));
    });

    // Go to style view
    const nextBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Next"),
    );
    await act(async () => {
      nextBtn?.click();
    });

    // Wait for blob rendering
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const copyBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Copy image"),
    );
    expect(copyBtn).toBeDefined();

    await act(async () => {
      copyBtn?.click();
    });

    expect(copyPng).toHaveBeenCalled();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root?.render(createElement(LyricsShareDialog, { track, onClose }));
    });

    const closeBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Close",
    );
    expect(closeBtn).toBeDefined();

    await act(async () => {
      closeBtn?.click();
    });

    expect(onClose).toHaveBeenCalled();
  });
});
