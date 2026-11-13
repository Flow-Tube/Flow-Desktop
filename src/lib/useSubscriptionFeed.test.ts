// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { recentUploadsPerChannel, useSubscriptionFeed } from "./useSubscriptionFeed";
import { setSetting } from "./api/db";
import { streamSubscriptionRssFeed, type SubscriptionRssFeed } from "./api/youtube";
import type { VideoSummary } from "../types/video";

vi.mock("./api/youtube", () => ({
  streamSubscriptionRssFeed: vi.fn(),
  scanSubscriptionCollaborations: vi.fn().mockResolvedValue([]),
  getSubscriptionRotationFeed: vi.fn().mockResolvedValue([]),
  getChannelDetails: vi.fn(),
}));
vi.mock("./api/db", () => ({ getSetting: vi.fn().mockResolvedValue(null), setSetting: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./api/recommendation", () => ({ observeChannelUploads: vi.fn().mockResolvedValue(undefined) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("recentUploadsPerChannel", () => {
  it("keeps the first six uploads of each channel and drops ones without a channel", () => {
    const videos = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, title: "a", channelName: "A", channelId: "UCa" })),
      { id: "b0", title: "b", channelName: "B", channelId: "UCb" },
      { id: "x", title: "x", channelName: "X" },
    ];
    const kept = recentUploadsPerChannel(videos);
    expect(kept.filter((video) => video.channelId === "UCa")).toHaveLength(6);
    expect(kept.map((video) => video.id)).toContain("b0");
    expect(kept.map((video) => video.id)).not.toContain("x");
  });
});

describe("refreshing a group of channels", () => {
  const upload = (id: string, channelId: string): VideoSummary => ({ id, title: id, channelName: channelId, channelId });
  const finished = (videos: VideoSummary[], failedChannelIds: string[]) =>
    ({ videos, channels: [], failedChannelIds, processed: 2, total: 2 }) as unknown as SubscriptionRssFeed;

  it("keeps the stored uploads of a channel it couldn't read, and saves them", async () => {
    vi.mocked(streamSubscriptionRssFeed).mockImplementationOnce(async (_ids, onFeed) => {
      onFeed(finished([upload("a1", "a"), upload("b1", "b")], []));
    });
    let hook!: ReturnType<typeof useSubscriptionFeed>;
    const channels = [{ id: "a" }, { id: "b" }] as Parameters<typeof useSubscriptionFeed>[0];
    function Probe() {
      hook = useSubscriptionFeed(channels);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(hook.videos.map((v) => v.id)).toEqual(["a1", "b1"]);

    vi.mocked(streamSubscriptionRssFeed).mockImplementationOnce(async (_ids, onFeed) => {
      onFeed(finished([upload("b2", "b")], ["a"]));
    });
    vi.mocked(setSetting).mockClear();
    await act(async () => hook.refreshChannels(["a", "b"]));

    expect(hook.videos.map((v) => v.id)).toEqual(["b2", "a1"]);
    expect(hook.failedChannelIds).toEqual(["a"]);
    const saved = JSON.parse(vi.mocked(setSetting).mock.lastCall![1]) as { videos: VideoSummary[] };
    expect(saved.videos.map((v) => v.id)).toEqual(["b2", "a1"]);

    // Offline: every channel failed and nothing is lost.
    vi.mocked(streamSubscriptionRssFeed).mockImplementationOnce(async (_ids, onFeed) => {
      onFeed(finished([], ["a", "b"]));
    });
    await act(async () => hook.refreshChannels(["a", "b"]));
    expect(hook.videos.map((v) => v.id)).toEqual(["b2", "a1"]);
    await act(async () => root.unmount());
  });
});

describe("refreshing the whole feed", () => {
  const upload = (id: string, channelId: string): VideoSummary => ({ id, title: id, channelName: channelId, channelId });
  const batch = (videos: VideoSummary[], processed: number) =>
    ({ videos, channels: [], failedChannelIds: [], processed, total: 2 }) as unknown as SubscriptionRssFeed;

  it("keeps the feed on screen until the scan is complete", async () => {
    vi.mocked(streamSubscriptionRssFeed).mockImplementationOnce(async (_ids, onFeed) => {
      onFeed(batch([upload("old1", "c"), upload("old2", "d")], 2));
    });
    let hook!: ReturnType<typeof useSubscriptionFeed>;
    const channels = [{ id: "c" }, { id: "d" }] as Parameters<typeof useSubscriptionFeed>[0];
    function Probe() {
      hook = useSubscriptionFeed(channels);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(hook.videos.map((v) => v.id)).toEqual(["old1", "old2"]);

    let finish!: () => void;
    vi.mocked(streamSubscriptionRssFeed).mockImplementationOnce(
      (_ids, onFeed) =>
        new Promise<void>((resolve) => {
          onFeed(batch([upload("new1", "c")], 1));
          finish = () => {
            onFeed(batch([upload("new1", "c"), upload("old1", "c"), upload("old2", "d")], 2));
            resolve();
          };
        }),
    );
    await act(async () => hook.refresh());
    // The first batch covers one channel: showing it would shrink the page under the reader.
    expect(hook.loading).toBe(false);
    expect(hook.videos.map((v) => v.id)).toEqual(["old1", "old2"]);
    expect(hook.scanProgress).toEqual({ processed: 1, total: 2 });

    await act(async () => finish());
    expect(hook.videos.map((v) => v.id)).toEqual(["new1", "old1", "old2"]);
    expect(hook.scanProgress).toBeNull();
    await act(async () => root.unmount());
  });
});
