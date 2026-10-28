import { describe, expect, it } from "vitest";
import { createEntry, type TabHistory } from "./tabHistory";
import { createTabId, insertTabAfter, neighborTab } from "./tabList";

const tab = (id: string): TabHistory => ({ id, entries: [createEntry("/")], index: 0 });
const ids = (tabs: TabHistory[]) => tabs.map((t) => t.id);

describe("insertTabAfter", () => {
  it("puts the new tab right after the given one", () => {
    expect(ids(insertTabAfter([tab("a"), tab("b")], "a", tab("n")))).toEqual(["a", "n", "b"]);
  });

  it("appends when the given tab is gone", () => {
    expect(ids(insertTabAfter([tab("a")], "x", tab("n")))).toEqual(["a", "n"]);
  });
});

describe("neighborTab", () => {
  const tabs = [tab("a"), tab("b"), tab("c")];

  it("prefers the tab below, then the one above", () => {
    expect(neighborTab(tabs, "b")?.id).toBe("c");
    expect(neighborTab(tabs, "c")?.id).toBe("b");
  });

  it("has none for the last tab left or an unknown id", () => {
    expect(neighborTab([tab("a")], "a")).toBeNull();
    expect(neighborTab(tabs, "x")).toBeNull();
  });
});

describe("createTabId", () => {
  it("makes distinct ids", () => {
    expect(createTabId()).not.toBe(createTabId());
  });
});
