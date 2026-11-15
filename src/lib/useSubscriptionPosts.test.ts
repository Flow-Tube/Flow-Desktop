// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentUploaderIds, useSubscriptionPosts } from "./useSubscriptionPosts";
import {
  forgetSubscriptionPosts,
  getSubscriptionPosts,
  type SubscriptionPost,
  type SubscriptionPostsPage,
} from "./api/youtube";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import type { SubscribedChannel } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";

vi.mock("./api/youtube", () => ({
  getSubscriptionPosts: vi.fn(),
  forgetSubscriptionPosts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./api/db", () => ({ getSetting: vi.fn().mockResolvedValue(null), setSetting: vi.fn().mockResolvedValue(undefined) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const channel = (id: string): SubscribedChannel => ({ id, name: id });
const upload = (id: string, channelId: string): VideoSummary => ({ id, title: id, channelName: channelId, channelId });
const item = (id: string, channelId = "a"): SubscriptionPost => ({
  post: { type: "post", id, authorName: channelId },
  channelId,
  publishedAt: 0,
});
const page = (ids: string[], nextPage: number | null): SubscriptionPostsPage => ({
  posts: ids.map((id) => item(id)),
  nextPage,
});
const ids = (posts: SubscriptionPost[]) => posts.map((entry) => entry.post.id);

type Props = Parameters<typeof useSubscriptionPosts>[0];
let hook!: ReturnType<typeof useSubscriptionPosts>;
let root: Root;

function Probe(props: Props) {
  hook = useSubscriptionPosts(props);
  return null;
}

async function render(props: Props) {
  await act(async () => root.render(createElement(Probe, props)));
}

beforeEach(() => {
  root = createRoot(document.createElement("div"));
  vi.mocked(getSubscriptionPosts).mockReset();
  vi.mocked(forgetSubscriptionPosts).mockClear();
  useFeedActionsStore.setState({ blockedChannelIds: new Set() });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("recentUploaderIds", () => {
  it("lists each channel once in the order of its latest upload", () => {
    const feed = [upload("v1", "b"), upload("v2", "channel:a"), upload("v3", "b"), { id: "x", title: "x", channelName: "x" }];
    expect(recentUploaderIds(feed)).toEqual(["b", "a"]);
  });
});

describe("useSubscriptionPosts", () => {
  const channels = [channel("a"), channel("b"), channel("blocked")];
  const feed = [upload("v1", "b"), upload("v2", "a")];

  it("reads nothing until the view is shown", async () => {
    await render({ channels, feed, enabled: false });
    expect(getSubscriptionPosts).not.toHaveBeenCalled();
    expect(hook).toMatchObject({ loading: false, empty: false, items: [] });
  });

  it("pages through the channels by activity, leaving blocked channels out", async () => {
    useFeedActionsStore.setState({ blockedChannelIds: new Set(["blocked"]) });
    vi.mocked(getSubscriptionPosts)
      .mockResolvedValueOnce(page(["p1", "p2"], 1))
      .mockResolvedValueOnce(page(["p3", "p2"], null));

    await render({ channels, feed, enabled: true });
    expect(getSubscriptionPosts).toHaveBeenLastCalledWith(
      [
        { id: "a", name: "a", avatarUrl: null },
        { id: "b", name: "b", avatarUrl: null },
      ],
      ["b", "a"],
      0,
    );
    expect(ids(hook.items)).toEqual(["p1", "p2"]);
    expect(hook).toMatchObject({ loading: false, hasMore: true, empty: false });

    await act(async () => hook.loadMore());
    expect(vi.mocked(getSubscriptionPosts).mock.lastCall?.[2]).toBe(1);
    expect(ids(hook.items)).toEqual(["p1", "p2", "p3"]);
    expect(hook).toMatchObject({ hasMore: false, loadingMore: false });

    await act(async () => hook.loadMore());
    expect(getSubscriptionPosts).toHaveBeenCalledTimes(2);
  });

  it("reads on past pages whose channels posted nothing recent", async () => {
    vi.mocked(getSubscriptionPosts)
      .mockResolvedValueOnce(page([], 1))
      .mockResolvedValueOnce(page([], 2))
      .mockResolvedValueOnce(page(["p1"], 3));

    await render({ channels, feed, enabled: true });
    expect(getSubscriptionPosts).toHaveBeenCalledTimes(3);
    expect(ids(hook.items)).toEqual(["p1"]);
    expect(hook.hasMore).toBe(true);
  });

  it("is empty once every channel was read without a recent post", async () => {
    vi.mocked(getSubscriptionPosts).mockResolvedValueOnce(page([], 1)).mockResolvedValueOnce(page([], null));

    await render({ channels, feed, enabled: true });
    expect(hook).toMatchObject({ empty: true, loading: false, hasMore: false, error: null });
  });

  it("shows a failed first page as an error and retries that page", async () => {
    vi.mocked(getSubscriptionPosts).mockRejectedValueOnce({ kind: "network", message: "offline" });

    await render({ channels, feed, enabled: true });
    expect(hook).toMatchObject({ loading: false, empty: false, error: { kind: "network" } });

    vi.mocked(getSubscriptionPosts).mockResolvedValueOnce(page(["p1"], null));
    await act(async () => hook.retry());
    expect(vi.mocked(getSubscriptionPosts).mock.lastCall?.[2]).toBe(0);
    expect(ids(hook.items)).toEqual(["p1"]);
    expect(hook.error).toBeNull();
  });

  it("keeps the posts shown when a later page fails, and retries that page", async () => {
    vi.mocked(getSubscriptionPosts)
      .mockResolvedValueOnce(page(["p1"], 1))
      .mockRejectedValueOnce({ kind: "rateLimited", message: "slow down" });

    await render({ channels, feed, enabled: true });
    await act(async () => hook.loadMore());
    expect(ids(hook.items)).toEqual(["p1"]);
    expect(hook.error).toMatchObject({ kind: "rateLimited" });

    vi.mocked(getSubscriptionPosts).mockResolvedValueOnce(page(["p2"], null));
    await act(async () => hook.retry());
    expect(vi.mocked(getSubscriptionPosts).mock.lastCall?.[2]).toBe(1);
    expect(ids(hook.items)).toEqual(["p1", "p2"]);
  });

  it("refreshes from the top over the posts shown, after forgetting the cache", async () => {
    vi.mocked(getSubscriptionPosts).mockResolvedValueOnce(page(["p1", "p2"], 1));
    await render({ channels, feed, enabled: true });

    let answer!: (value: SubscriptionPostsPage) => void;
    vi.mocked(getSubscriptionPosts).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await act(async () => hook.refresh());
    expect(forgetSubscriptionPosts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getSubscriptionPosts).mock.lastCall?.[2]).toBe(0);
    expect(ids(hook.items)).toEqual(["p1", "p2"]);
    expect(hook).toMatchObject({ refreshing: true, loading: false, loadingMore: false });

    await act(async () => answer(page(["p2", "p0"], null)));
    expect(ids(hook.items)).toEqual(["p2", "p0"]);
    expect(hook.refreshing).toBe(false);
  });

  it("starts over for another group and ignores the old group's late answer", async () => {
    let late!: (value: SubscriptionPostsPage) => void;
    vi.mocked(getSubscriptionPosts).mockReturnValueOnce(new Promise((resolve) => (late = resolve)));
    await render({ channels, feed, enabled: true });
    expect(hook.loading).toBe(true);

    vi.mocked(getSubscriptionPosts).mockResolvedValueOnce(page(["b1"], null));
    await render({ channels: [channel("b")], feed, enabled: true });
    expect(ids(hook.items)).toEqual(["b1"]);

    await act(async () => late(page(["a1"], null)));
    expect(ids(hook.items)).toEqual(["b1"]);
  });

  it("keeps its posts while hidden and does not read them again when shown", async () => {
    vi.mocked(getSubscriptionPosts).mockResolvedValueOnce(page(["p1"], null));
    await render({ channels, feed, enabled: true });
    await render({ channels, feed, enabled: false });
    await render({ channels, feed, enabled: true });
    expect(getSubscriptionPosts).toHaveBeenCalledTimes(1);
    expect(ids(hook.items)).toEqual(["p1"]);
  });
});
