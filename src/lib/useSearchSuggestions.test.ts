import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSearchSuggestions: vi.fn(),
  getMusicSearchSuggestions: vi.fn(),
}));
vi.mock("./api/youtube", () => ({ getSearchSuggestions: api.getSearchSuggestions }));
vi.mock("./api/music", () => ({ getMusicSearchSuggestions: api.getMusicSearchSuggestions }));

import { useSearchSuggestions } from "./useSearchSuggestions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let latest: ReturnType<typeof useSearchSuggestions> | null = null;

function Probe({ musicEnabled }: { musicEnabled: boolean }) {
  latest = useSearchSuggestions("linux", "US", true, musicEnabled);
  return null;
}

async function suggest(musicEnabled: boolean) {
  act(() => root.render(createElement(Probe, { musicEnabled })));
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
});
