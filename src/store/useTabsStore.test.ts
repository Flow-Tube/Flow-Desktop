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
