import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSearchSuggestions: vi.fn(),
  getMusicSearchSuggestions: vi.fn(),
  warmSearchSuggestions: vi.fn(),
}));
vi.mock("./api/youtube", () => ({
  getSearchSuggestions: api.getSearchSuggestions,
  warmSearchSuggestions: api.warmSearchSuggestions,
}));
vi.mock("./api/music", () => ({ getMusicSearchSuggestions: api.getMusicSearchSuggestions }));

import { useSearchSuggestions, warmSuggestionsOnFocus } from "./useSearchSuggestions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let latest: ReturnType<typeof useSearchSuggestions> | null = null;

function Probe({ musicEnabled, query }: { musicEnabled: boolean; query: string }) {
  latest = useSearchSuggestions(query, "US", true, musicEnabled);
  return null;
}

async function suggest(musicEnabled: boolean, query = "linux") {
  act(() => root.render(createElement(Probe, { musicEnabled, query })));
  await act(async () => {
    vi.advanceTimersByTime(300);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

describe("useSearchSuggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.getSearchSuggestions.mockReset().mockResolvedValue([{ text: "linux kernel", entity: null }]);
    api.getMusicSearchSuggestions.mockReset().mockResolvedValue({
      recommendedItems: [{ type: "artist", id: "UC1", title: "Artist", thumbnail: null }],
    });
    latest = null;
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("asks YouTube and YouTube Music", async () => {
    await suggest(true);
    expect(api.getMusicSearchSuggestions).toHaveBeenCalledWith("linux");
    expect(latest?.suggestions).toHaveLength(1);
    expect(latest?.musicItems).toHaveLength(1);
  });

  it("never asks YouTube Music while Show Music is off", async () => {
    await suggest(false);
    expect(api.getSearchSuggestions).toHaveBeenCalledWith("linux", "US");
    expect(api.getMusicSearchSuggestions).not.toHaveBeenCalled();
    expect(latest?.suggestions).toHaveLength(1);
    expect(latest?.musicItems).toEqual([]);
  });

  it("keeps the request for a word when only a trailing space is typed", async () => {
    let answer: (rows: unknown[]) => void = () => undefined;
    api.getSearchSuggestions.mockReset().mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await suggest(false, "linux");
    await suggest(false, "linux ");
    await act(async () => {
      answer([{ text: "linux mint", entity: null }]);
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(api.getSearchSuggestions).toHaveBeenCalledTimes(1);
    expect(latest?.suggestions).toEqual([{ text: "linux mint", entity: null }]);
  });

  it("keeps the rows on screen when a newer request fails", async () => {
    await suggest(true, "linux");
    api.getSearchSuggestions.mockRejectedValueOnce(new Error("offline"));
    api.getMusicSearchSuggestions.mockRejectedValueOnce(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await suggest(true, "linux k");
    warn.mockRestore();
    expect(api.getSearchSuggestions).toHaveBeenLastCalledWith("linux k", "US");
    expect(latest?.suggestions).toEqual([{ text: "linux kernel", entity: null }]);
    expect(latest?.musicItems).toHaveLength(1);
  });
});

describe("warmSuggestionsOnFocus", () => {
  it("opens the connection at most once a minute", () => {
    api.warmSearchSuggestions.mockReset().mockResolvedValue(undefined);
    warmSuggestionsOnFocus(1_000_000);
    warmSuggestionsOnFocus(1_030_000);
    expect(api.warmSearchSuggestions).toHaveBeenCalledTimes(1);
    warmSuggestionsOnFocus(1_061_000);
    expect(api.warmSearchSuggestions).toHaveBeenCalledTimes(2);
  });
});
