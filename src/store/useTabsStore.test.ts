import { beforeEach, describe, expect, it } from "vitest";
import { NavigationType } from "react-router-dom";
import { activeTab, useTabsStore } from "./useTabsStore";
import { createEntry } from "../lib/tabs/tabHistory";

const paths = () => activeTab(useTabsStore.getState()).entries.map((entry) => entry.pathname);
const index = () => activeTab(useTabsStore.getState()).index;

describe("useTabsStore navigation", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", entries: [createEntry("/")], index: 0 }],
      activeId: "tab-1",
      action: NavigationType.Pop,
      cause: "history",
      playerTabId: null,
      parked: {},
    });
  });

  it("starts from the page the window opened on", () => {
    expect(paths()).toEqual(["/"]);
  });

  it("pushes, replaces and walks the active tab's list", () => {
    const { push, replace, go } = useTabsStore.getState();
    push("/feed");
    push("/watch/abc", { from: "feed" });
    expect(useTabsStore.getState().action).toBe(NavigationType.Push);
    replace("/watch/def");
    expect(useTabsStore.getState().action).toBe(NavigationType.Replace);
    expect(paths()).toEqual(["/", "/feed", "/watch/def"]);

    go(-2);
    expect(index()).toBe(0);
    expect(useTabsStore.getState().action).toBe(NavigationType.Pop);
    go(1);
    expect(index()).toBe(1);
  });

  it("leaves the state alone when Back has nowhere to go", () => {
    const before = useTabsStore.getState();
    before.go(-1);
    expect(useTabsStore.getState().tabs).toBe(before.tabs);
  });
});

describe("useTabsStore tabs", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", entries: [createEntry("/")], index: 0 }],
      activeId: "tab-1",
      action: NavigationType.Pop,
      cause: "history",
      playerTabId: null,
      parked: {},
    });
  });

  it("opens a background tab after the current one, or a foreground one when asked", () => {
    const background = useTabsStore.getState().openTab("/feed");
    expect(useTabsStore.getState().activeId).toBe("tab-1");
    const foreground = useTabsStore.getState().openTab("/music", { activate: true });
    const state = useTabsStore.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual(["tab-1", foreground, background]);
    expect(state.activeId).toBe(foreground);
    expect(state.cause).toBe("tab");
    expect(paths()).toEqual(["/music"]);
  });

  it("replaces a background tab's page without touching the active one", () => {
    const other = useTabsStore.getState().openTab("/watch/a");
    useTabsStore.getState().replaceInTab(other, "/watch/b");
    const tab = useTabsStore.getState().tabs.find((candidate) => candidate.id === other)!;
    expect(tab.entries.map((entry) => entry.pathname)).toEqual(["/watch/b"]);
    expect(paths()).toEqual(["/"]);
  });

  it("closes a tab with its parked video and hands focus to the neighbour", () => {
    const other = useTabsStore.getState().openTab("/feed");
    useTabsStore.getState().park("tab-1", { videoId: "v", positionSeconds: 1, queue: [], currentIndex: 0, playlistContext: null });
    useTabsStore.getState().setPlayerTab("tab-1");
    useTabsStore.getState().closeTab("tab-1");
    const state = useTabsStore.getState();
    expect(state.activeId).toBe(other);
    expect(state.parked).toEqual({});
    expect(state.playerTabId).toBeNull();
  });

  it("marks a switch as a tab change and ignores unknown tabs", () => {
    const other = useTabsStore.getState().openTab("/feed");
    useTabsStore.getState().push("/music");
    useTabsStore.getState().activateTab("nope");
    expect(useTabsStore.getState().cause).toBe("history");
    useTabsStore.getState().activateTab(other);
    expect(useTabsStore.getState().cause).toBe("tab");
    expect(useTabsStore.getState().action).toBe(NavigationType.Pop);
  });
});
