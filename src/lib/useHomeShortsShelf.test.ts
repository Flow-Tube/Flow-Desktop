// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getShortsFeed = vi.fn();
vi.mock("./api/shorts", () => ({
  getShortsFeed: (...args: unknown[]) => getShortsFeed(...args),
  loadMoreShorts: vi.fn(),
  resetShortsFeed: vi.fn(),
}));
vi.mock("./useWatchedFilter", () => ({ loadFinishedShortIds: async () => new Set<string>() }));
vi.mock("../store/useSubscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ subscriptions: [{ id: "s" }], loadSubscriptions: vi.fn() }) },
}));

const { useHomeShortsShelf, forgetHomeShortsShelf } = await import("./useHomeShortsShelf");
const { useFeedActionsStore } = await import("../store/useFeedActionsStore");
const { useAppSettingsStore } = await import("../store/useAppSettingsStore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string) => ({ id, title: id, channelName: "c", channelId: null, thumbnailUrl: "" });
let shelf: ReturnType<typeof useHomeShortsShelf>;
let root: Root;
function Probe({ enabled, refreshCount = 0 }: { enabled: boolean; refreshCount?: number }) {
  shelf = useHomeShortsShelf(enabled, refreshCount);
  return null;
}
const render = (enabled: boolean, refreshCount = 0) =>
  act(async () => root.render(createElement(Probe, { enabled, refreshCount })));

beforeEach(() => {
  forgetHomeShortsShelf();
  getShortsFeed.mockReset();
  useAppSettingsStore.setState({ loaded: true });
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(async () => root.unmount()));

describe("useHomeShortsShelf", () => {
  it("asks for nothing while off", async () => {
    await render(false);
    expect(getShortsFeed).not.toHaveBeenCalled();
    expect(shelf).toEqual([]);
  });

  it("waits for settings, since a shelf turned off reads as on until they load", async () => {
    getShortsFeed.mockResolvedValue({ items: [item("v")], continuation: null });
    useAppSettingsStore.setState({ loaded: false });
    await render(true);
    expect(getShortsFeed).not.toHaveBeenCalled();
    await act(async () => useAppSettingsStore.setState({ loaded: true }));
    expect(getShortsFeed).toHaveBeenCalledTimes(1);
  });

  it("shows up to 15, leaving out what is hidden, and reuses the load", async () => {
    getShortsFeed.mockResolvedValue({ items: Array.from({ length: 20 }, (_, i) => item(`v${i}`)), continuation: null });
    useFeedActionsStore.setState({ dismissedVideoIds: new Set(["v0"]) });
    await render(true);
    expect(shelf.map((s) => s.id)[0]).toBe("v1");
    expect(shelf).toHaveLength(15);
    await render(false);
    await render(true);
    expect(getShortsFeed).toHaveBeenCalledTimes(1);
    useFeedActionsStore.setState({ dismissedVideoIds: new Set() });
  });

  it("shows nothing when the feed fails, and tries again next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getShortsFeed.mockRejectedValueOnce(new Error("down"));
    await render(true);
    expect(shelf).toEqual([]);
    await render(false);
    getShortsFeed.mockResolvedValue({ items: [item("a")], continuation: null });
    await render(true);
    expect(shelf.map((s) => s.id)).toEqual(["a"]);
    warn.mockRestore();
  });

  it("asks for a new shelf on Home's refresh and keeps the old one until it comes", async () => {
    getShortsFeed.mockResolvedValueOnce({ items: [item("old")], continuation: null });
    await render(true);
    expect(shelf.map((s) => s.id)).toEqual(["old"]);
    let answer: (feed: unknown) => void = () => {};
    getShortsFeed.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(true, 1);
    expect(getShortsFeed).toHaveBeenCalledTimes(2);
    expect(shelf.map((s) => s.id)).toEqual(["old"]);
    await act(async () => answer({ items: [item("new")], continuation: null }));
    expect(shelf.map((s) => s.id)).toEqual(["new"]);
  });
});
