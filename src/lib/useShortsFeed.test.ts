// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getShortsFeed = vi.fn();
const loadMoreShorts = vi.fn();
vi.mock("./api/shorts", () => ({
  getShortsFeed: (...args: unknown[]) => getShortsFeed(...args),
  loadMoreShorts: (...args: unknown[]) => loadMoreShorts(...args),
  resetShortsFeed: vi.fn(),
}));
vi.mock("../store/useSubscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ subscriptions: [], loadSubscriptions: vi.fn() }) },
}));

const { useShortsFeed } = await import("./useShortsFeed");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string) => ({ id, title: id, channelName: "c", channelId: null, thumbnailUrl: "" }) as never;
const shelf = [item("a"), item("b")];
let hook: ReturnType<typeof useShortsFeed>;
let root: Root;
function Probe({ end }: { end: "feed" | "stop" | undefined }) {
  hook = useShortsFeed("a", null, end ? shelf : null, end);
  return null;
}
const ids = () => hook.items.map((short: { id: string }) => short.id);
const render = (end: "feed" | "stop" | undefined) => act(async () => root.render(createElement(Probe, { end })));

beforeEach(() => {
  getShortsFeed.mockReset();
  loadMoreShorts.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(async () => root.unmount()));

describe("useShortsFeed queue ends", () => {
  it("stays with a shelf until it runs out, then hands over to the seeded feed", async () => {
    getShortsFeed.mockResolvedValue({ items: [item("b"), item("c")], continuation: "next" });
    loadMoreShorts.mockResolvedValue({ items: [item("d")], continuation: null });
    await render("feed");
    expect(getShortsFeed).not.toHaveBeenCalled();
    expect(ids()).toEqual(["a", "b"]);

    await act(async () => hook.loadMore());
    expect(getShortsFeed).toHaveBeenCalledWith([], "a");
    expect(ids()).toEqual(["a", "b", "c"]);

    await act(async () => hook.loadMore());
    expect(loadMoreShorts).toHaveBeenCalledWith([], "next");
    expect(ids()).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps Saved finite", async () => {
    await render("stop");
    await act(async () => hook.loadMore());
    expect(getShortsFeed).not.toHaveBeenCalled();
    expect(loadMoreShorts).not.toHaveBeenCalled();
    expect(ids()).toEqual(["a", "b"]);
  });

  it("still loads the feed at once without a queue", async () => {
    getShortsFeed.mockResolvedValue({ items: [item("x")], continuation: null });
    await render(undefined);
    expect(getShortsFeed).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(["a", "x"]);
  });

  it("can retry a hand-over that failed", async () => {
    getShortsFeed.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ items: [item("c")], continuation: null });
    await render("feed");
    await act(async () => hook.loadMore());
    expect(ids()).toEqual(["a", "b"]);
    await act(async () => hook.loadMore());
    expect(ids()).toEqual(["a", "b", "c"]);
  });
});
