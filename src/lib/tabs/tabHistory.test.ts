import { describe, expect, it } from "vitest";
import {
  MAX_TAB_ENTRIES,
  createEntry,
  currentEntry,
  goInTab,
  pushEntry,
  replaceEntry,
  type TabHistory,
} from "./tabHistory";

function tabAt(...paths: string[]): TabHistory {
  return { id: "t", entries: paths.map((path) => createEntry(path)), index: paths.length - 1 };
}

describe("createEntry", () => {
  it("splits a string path into its parts", () => {
    const entry = createEntry("/search?q=lofi#top", { from: "home" });
    expect(entry).toMatchObject({ pathname: "/search", search: "?q=lofi", hash: "#top", state: { from: "home" } });
    expect(entry.key).toMatch(/^[a-z0-9]+$/);
  });

  it("fills missing parts of a path object", () => {
    expect(createEntry({ pathname: "/feed" })).toMatchObject({ pathname: "/feed", search: "", hash: "", state: null });
  });

  it("gives every entry its own key", () => {
    expect(createEntry("/").key).not.toBe(createEntry("/").key);
  });
});

describe("pushEntry", () => {
  it("drops the forward entries, like a browser", () => {
    const back = goInTab(tabAt("/", "/feed", "/music"), -2)!;
    const next = pushEntry(back, createEntry("/search"));
    expect(next.entries.map((entry) => entry.pathname)).toEqual(["/", "/search"]);
    expect(next.index).toBe(1);
  });

  it("keeps at most MAX_TAB_ENTRIES, dropping the oldest", () => {
    let tab = tabAt("/0");
    for (let i = 1; i <= MAX_TAB_ENTRIES + 5; i += 1) tab = pushEntry(tab, createEntry(`/${i}`));
    expect(tab.entries).toHaveLength(MAX_TAB_ENTRIES);
    expect(tab.index).toBe(MAX_TAB_ENTRIES - 1);
    expect(currentEntry(tab).pathname).toBe(`/${MAX_TAB_ENTRIES + 5}`);
    expect(tab.entries[0]?.pathname).toBe("/6");
  });
});

describe("replaceEntry", () => {
  it("swaps the current entry and keeps the forward ones", () => {
    const back = goInTab(tabAt("/", "/feed"), -1)!;
    const next = replaceEntry(back, createEntry("/music"));
    expect(next.entries.map((entry) => entry.pathname)).toEqual(["/music", "/feed"]);
    expect(next.index).toBe(0);
  });
});

describe("goInTab", () => {
  it("moves within the list", () => {
    expect(goInTab(tabAt("/", "/feed", "/music"), -1)?.index).toBe(1);
  });

  it("returns null outside the list or for no step", () => {
    const tab = tabAt("/", "/feed");
    expect(goInTab(tab, 1)).toBeNull();
    expect(goInTab(tab, -2)).toBeNull();
    expect(goInTab(tab, 0)).toBeNull();
  });
});
