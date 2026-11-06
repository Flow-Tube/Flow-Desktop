import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoCard } from "./VideoCard";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import type { VideoSummary } from "../../types/video";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api/youtube", () => ({
  getVideoDetails: vi.fn(),
  getChannelDetails: vi.fn(async (id: string) => ({
    id,
    name: "Mocked Channel",
    avatarUrl: null,
    verified: false,
    tabs: [],
  })),
}));
vi.mock("../../lib/api/downloads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/downloads")>()),
  listDownloads: vi.fn(async () => []),
  getDownloadedVideoIds: vi.fn(async () => []),
}));

describe("VideoCard channel name and view count rendering", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    useSubscriptionStore.setState({ subscriptions: [] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("does not render view count as channel name when channelName is corrupted", async () => {
    const video: VideoSummary = {
      id: "v123",
      title: "Test Video",
      channelName: "105K views",
      publishedText: "3 days ago",
    };

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(VideoCard, { video, onPlay: vi.fn() })));
    });

    const textContent = host.textContent || "";
    // "105K views" should be present on the stats line
    expect(textContent).toContain("105K views");
    expect(textContent).toContain("3 days ago");

    // But ChannelLabel should not contain "105K views"
    const channelLabels = host.querySelectorAll(".truncate");
    const channelTexts = Array.from(channelLabels).map((el) => el.textContent?.trim());
    expect(channelTexts).not.toContain("105K views");
  });

  it("resolves channel name from subscription store when channelName is corrupted", async () => {
    useSubscriptionStore.setState({
      subscriptions: [{ id: "UC-MADDOCK", name: "Maddock Films", subscribedAt: 0 }],
    });

    const video: VideoSummary = {
      id: "v456",
      title: "Trailer Launch",
      channelId: "UC-MADDOCK",
      channelName: "105K views",
      publishedText: "3 days ago",
    };

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(VideoCard, { video, onPlay: vi.fn() })));
    });

    const textContent = host.textContent || "";
    expect(textContent).toContain("Maddock Films");
    expect(textContent).toContain("105K views");
    expect(textContent).toContain("3 days ago");

    const channelLabels = host.querySelectorAll(".truncate");
    const channelTexts = Array.from(channelLabels).map((el) => el.textContent?.trim());
    expect(channelTexts).toContain("Maddock Films");
    expect(channelTexts).not.toContain("105K views");
  });

  it("does not render 'Unknown Channel' when channelName is 'Unknown Channel' and cannot be resolved", async () => {
    const video: VideoSummary = {
      id: "v789",
      title: "My Cool Video",
      channelId: "UC-SOME-UNKNOWN",
      channelName: "Unknown Channel",
      publishedText: "1 day ago",
      viewCountText: "50% watched",
    };

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(VideoCard, { video, onPlay: vi.fn() })));
    });

    const textContent = host.textContent || "";
    expect(textContent).not.toContain("Unknown Channel");
    expect(textContent).toContain("My Cool Video");
    expect(textContent).toContain("50% watched");
    expect(textContent).toContain("1 day ago");

    const channelLabels = host.querySelectorAll(".truncate");
    const channelTexts = Array.from(channelLabels).map((el) => el.textContent?.trim());
    expect(channelTexts).not.toContain("Unknown Channel");
  });

  it("resolves channel name via channel metadata hook when channelName is corrupted and not in subscriptions", async () => {
    const video: VideoSummary = {
      id: "v999",
      title: "The worst week in cybersecurity...",
      channelId: "UCsBjURrPoezykLs9EqgamOA",
      channelName: "1.2M views",
      publishedText: "20 hours ago",
    };

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(VideoCard, { video, onPlay: vi.fn() })));
    });

    const textContent = host.textContent || "";
    expect(textContent).toContain("The worst week in cybersecurity...");
    expect(textContent).toContain("1.2M views");
    expect(textContent).toContain("20 hours ago");

    const channelLabels = host.querySelectorAll(".truncate");
    const channelTexts = Array.from(channelLabels).map((el) => el.textContent?.trim());
    expect(channelTexts).not.toContain("1.2M views");
  });
});
