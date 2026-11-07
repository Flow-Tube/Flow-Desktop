import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchSuggestions } from "./useSearchSuggestions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSearchSuggestions = vi.fn();
const getMusicSearchSuggestions = vi.fn();

vi.mock("./api/youtube", () => ({
  getSearchSuggestions: (q: string, region?: string | null) => getSearchSuggestions(q, region),
}));
vi.mock("./api/music", () => ({
  getMusicSearchSuggestions: (q: string) => getMusicSearchSuggestions(q),
}));

const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });

describe("useSearchSuggestions", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useSearchSuggestions> | null = null;

  function Probe({ query, musicEnabled }: { query: string; musicEnabled: boolean }) {
    latest = useSearchSuggestions(query, "US", musicEnabled);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    latest = null;
    getSearchSuggestions.mockResolvedValue([{ text: "linux kernel", entity: null }]);
    getMusicSearchSuggestions.mockResolvedValue({
      recommendedItems: [{ type: "artist", id: "UC1", title: "Artist", thumbnail: null, channelId: "UC1" }],
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("queries both YouTube and YouTube Music when music is enabled", async () => {
    act(() => root.render(createElement(Probe, { query: "linux", musicEnabled: true })));
    act(() => { vi.advanceTimersByTime(300); });
    await flush();

    expect(getSearchSuggestions).toHaveBeenCalledExactlyOnceWith("linux", "US");
    expect(getMusicSearchSuggestions).toHaveBeenCalledExactlyOnceWith("linux");
    expect(latest?.suggestions).toHaveLength(1);
    expect(latest?.musicItems).toHaveLength(1);
  });

  it("skips YouTube Music requests and clears music items when music is disabled", async () => {
    act(() => root.render(createElement(Probe, { query: "linux", musicEnabled: false })));
    act(() => { vi.advanceTimersByTime(300); });
    await flush();

    expect(getSearchSuggestions).toHaveBeenCalledExactlyOnceWith("linux", "US");
    expect(getMusicSearchSuggestions).not.toHaveBeenCalled();
    expect(latest?.suggestions).toHaveLength(1);
    expect(latest?.musicItems).toEqual([]);
  });
});
