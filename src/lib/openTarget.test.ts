import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationType } from "react-router-dom";
import type { VideoSummary } from "../types/video";

const openAppWindow = vi.fn(async () => "flow-1");
vi.mock("./api/appWindow", () => ({ openAppWindow }));
vi.mock("./streamResolution", () => ({ prefetchStreamInfo: vi.fn(), readStreamInfoEntry: () => null }));

const { backgroundTabClickProps, moveTabToNewWindow, moveVideoToNewWindow, routeForVideo } = await import("./openTarget");
const { useTabsStore } = await import("../store/useTabsStore");
const { usePlayerStore } = await import("../store/usePlayerStore");
const { createEntry } = await import("./tabs/tabHistory");
const { useAppSettingsStore } = await import("../store/useAppSettingsStore");
const { openedInBackgroundTab } = await import("./openTarget");

const setTabsOn = (on: boolean) =>
  useAppSettingsStore.setState((state) => ({ values: { ...state.values, tabs_enabled: String(on) } }));

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "Flow" });

beforeEach(() => {
  useTabsStore.setState({
    tabs: [
      { id: "a", entries: [createEntry("/"), createEntry("/watch/p")], index: 1 },
      { id: "b", entries: [createEntry("/watch/n")], index: 0 },
    ],
    activeId: "a",
    action: NavigationType.Pop,
    cause: "history",
    playerTabId: "a",
    parked: { b: { videoId: "n", positionSeconds: 30, queue: [video("n")], currentIndex: 0, playlistContext: null } },
    titles: {},
  });
  usePlayerStore.getState().setQueue([video("p")], 0);
  usePlayerStore.getState().setCurrentTime(12);
  setTabsOn(true);
});

afterEach(() => {
  openAppWindow.mockClear();
  usePlayerStore.getState().clearQueue();
});

describe("routeForVideo", () => {
  it("picks the watch page, the Shorts player or the channel page", () => {
    expect(routeForVideo({ id: "abc" })).toBe("/watch/abc");
    expect(routeForVideo({ id: "abc", isShort: true })).toBe("/shorts/abc");
    expect(routeForVideo({ id: "channel:UC1" })).toBe("/channel/UC1");
  });
});

describe("backgroundTabClickProps", () => {
  it("opens a background tab on middle-click only", () => {
    const props = backgroundTabClickProps("/feed");
    const event = (button: number) => ({ button, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as never;
    props.onAuxClick(event(2));
    expect(useTabsStore.getState().tabs).toHaveLength(2);
    props.onAuxClick(event(1));
    const state = useTabsStore.getState();
    expect(state.tabs.map((tab) => tab.entries[0]?.pathname)).toEqual(["/", "/feed", "/watch/n"]);
    expect(state.activeId).toBe("a");
  });
});

describe("with tabs off", () => {
  it("opens no tabs, and a modified click falls through to a normal one", () => {
    setTabsOn(false);
    const event = { button: 0, ctrlKey: true, metaKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as never;
    expect(openedInBackgroundTab(event, "/feed")).toBe(false);
    backgroundTabClickProps("/feed").onAuxClick({ button: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() } as never);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });
});

describe("moving to a new window", () => {
  it("moves the playing video with its position and steps this tab back", async () => {
    await moveVideoToNewWindow();
    expect(openAppWindow).toHaveBeenCalledWith("/watch/p", expect.objectContaining({ positionSeconds: 12, currentIndex: 0 }));
    expect(usePlayerStore.getState().currentVideo).toBeNull();
    const tab = useTabsStore.getState().tabs[0]!;
    expect(tab.entries[tab.index]?.pathname).toBe("/");
  });

  it("moves a background tab with its parked video, paused, and closes it here", async () => {
    await moveTabToNewWindow("b");
    expect(openAppWindow).toHaveBeenCalledWith("/watch/n", expect.objectContaining({ positionSeconds: 30, playing: false }));
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(["a"]);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("p");
  });

  it("keeps the window's last tab, on Home", async () => {
    await moveTabToNewWindow("b");
    await moveTabToNewWindow("a");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.entries[tabs[0].index]?.pathname).toBe("/");
    expect(usePlayerStore.getState().currentVideo).toBeNull();
  });
});
