import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationType } from "react-router-dom";
import type { VideoSummary } from "../../types/video";

vi.mock("../streamResolution", () => ({ prefetchStreamInfo: vi.fn() }));

const { usePlayerStore } = await import("../../store/usePlayerStore");
const { activeTab, useTabsStore } = await import("../../store/useTabsStore");
const { createEntry } = await import("./tabHistory");
const { closeTabWithPlayback, expandPlayerInOwnerTab, installTabPlaybackSync, switchToTab } = await import("./tabPlayback");

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "Flow" });
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const tabs = () => useTabsStore.getState();
const pathOf = (id: string) => {
  const tab = tabs().tabs.find((candidate) => candidate.id === id)!;
  return tab.entries[tab.index]!.pathname;
};

/** What a card click does: start the video, then open its page in the active tab. */
function playFromCard(id: string) {
  usePlayerStore.getState().setQueue([video(id)], 0);
  tabs().push(`/watch/${id}`);
}

let uninstall: () => void;

beforeEach(() => {
  useTabsStore.setState({
    tabs: [
      { id: "a", entries: [createEntry("/")], index: 0 },
      { id: "b", entries: [createEntry("/")], index: 0 },
    ],
    activeId: "a",
    action: NavigationType.Pop,
    cause: "history",
    playerTabId: null,
    parked: {},
  });
  uninstall = installTabPlaybackSync();
});

afterEach(() => {
  uninstall();
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ pipHandoff: null });
});

describe("tab playback", () => {
  it("gives the player to the tab that started it", async () => {
    playFromCard("p");
    await flush();
    expect(tabs().playerTabId).toBe("a");
  });

  it("parks the first tab's video when another tab opens one, and resumes it on return", async () => {
    playFromCard("p");
    await flush();
    usePlayerStore.getState().setCurrentTime(42);

    switchToTab("b");
    expect(tabs().cause).toBe("tab");
    playFromCard("n");
    await flush();
    expect(tabs().playerTabId).toBe("b");
    expect(tabs().parked.a).toMatchObject({ videoId: "p", positionSeconds: 42 });

    usePlayerStore.getState().setCurrentTime(7);
    switchToTab("a");
    expect(tabs().activeId).toBe("a");
    expect(tabs().playerTabId).toBe("a");
    expect(usePlayerStore.getState().currentVideo?.id).toBe("p");
    expect(usePlayerStore.getState().pipHandoff).toEqual({ videoId: "p", positionSeconds: 42, playing: true });
    expect(tabs().parked.b).toMatchObject({ videoId: "n", positionSeconds: 7 });
    expect(tabs().parked.a).toBeUndefined();
  });

  it("moves the owner tab's page along when its queue advances in the mini player", async () => {
    usePlayerStore.getState().setQueue([video("p"), video("q")], 0);
    tabs().push("/watch/p");
    await flush();
    switchToTab("b");

    usePlayerStore.getState().playQueueItem(1);
    await flush();
    expect(tabs().playerTabId).toBe("a");
    expect(pathOf("a")).toBe("/watch/q");
    expect(pathOf("b")).toBe("/");
    expect(tabs().parked.a).toBeUndefined();
  });

  it("forgets the owner when the video is closed", async () => {
    playFromCard("p");
    await flush();
    usePlayerStore.getState().dismissVideoPlayer();
    expect(tabs().playerTabId).toBeNull();
  });

  it("closes the video with its tab and moves to the neighbour", async () => {
    playFromCard("p");
    await flush();
    closeTabWithPlayback("a");
    expect(usePlayerStore.getState().currentVideo).toBeNull();
    expect(tabs().tabs.map((tab) => tab.id)).toEqual(["b"]);
    expect(tabs().activeId).toBe("b");
  });

  it("never closes the last tab", () => {
    closeTabWithPlayback("a");
    closeTabWithPlayback("b");
    expect(tabs().tabs).toHaveLength(1);
  });

  it("expands the mini player in its own tab", async () => {
    playFromCard("p");
    await flush();
    tabs().push("/subscriptions");
    switchToTab("b");

    expect(expandPlayerInOwnerTab()).toBe(true);
    expect(tabs().activeId).toBe("a");
    expect(activeTab(tabs()).entries.map((entry) => entry.pathname)).toEqual(["/", "/watch/p", "/subscriptions", "/watch/p"]);
  });

  it("leaves expanding to the caller when the owner is already in front", async () => {
    playFromCard("p");
    await flush();
    expect(expandPlayerInOwnerTab()).toBe(false);
  });
});
