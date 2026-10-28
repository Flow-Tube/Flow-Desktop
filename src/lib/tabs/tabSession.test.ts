import { describe, expect, it } from "vitest";
import { createEntry, type TabHistory } from "./tabHistory";
import { parseTabSession, restoreTabSession, serializeTabSession } from "./tabSession";

const parked = (videoId: string, positionSeconds: number) => ({
  videoId,
  positionSeconds,
  queue: [{ id: videoId, title: videoId, channelName: "Flow" }],
  currentIndex: 0,
  playlistContext: null,
});

const tabs: TabHistory[] = [
  { id: "a", entries: [createEntry("/"), createEntry("/watch/p", { from: "home" })], index: 1 },
  { id: "b", entries: [createEntry("/search?q=lofi")], index: 0 },
  { id: "c", entries: [createEntry("/watch/n")], index: 0 },
];

describe("tab session", () => {
  it("saves pages, titles and videos, filing the playing video under its tab", () => {
    const session = serializeTabSession({
      tabs,
      activeId: "b",
      parked: { c: parked("n", 30) },
      titles: { a: "Video P" },
      playing: { tabId: "a", video: parked("p", 12) },
    });
    expect(session.active).toBe(1);
    expect(session.tabs[0]).toEqual({
      entries: [{ pathname: "/", search: "", hash: "" }, { pathname: "/watch/p", search: "", hash: "" }],
      index: 1,
      title: "Video P",
      parked: parked("p", 12),
    });
    expect(session.tabs[1]?.entries[0]).toEqual({ pathname: "/search", search: "?q=lofi", hash: "" });
    expect(session.tabs[2]?.parked).toEqual(parked("n", 30));
  });

  it("round-trips through JSON into fresh tabs", () => {
    const raw = JSON.stringify(serializeTabSession({ tabs, activeId: "c", parked: {}, titles: { b: "lofi" }, playing: null }));
    const restored = restoreTabSession(parseTabSession(raw)!);
    expect(restored.tabs.map((tab) => tab.entries.map((entry) => entry.pathname + entry.search))).toEqual([
      ["/", "/watch/p"],
      ["/search?q=lofi"],
      ["/watch/n"],
    ]);
    expect(restored.activeId).toBe(restored.tabs[2]?.id);
    const second = restored.tabs[1]!;
    expect(restored.titles[second.id]).toEqual({ key: second.entries[0]!.key, text: "lofi" });
    expect(new Set(restored.tabs.map((tab) => tab.id)).size).toBe(3);
  });

  it("rejects damaged values and drops broken tabs", () => {
    expect(parseTabSession(null)).toBeNull();
    expect(parseTabSession("null")).toBeNull();
    expect(parseTabSession("{not json")).toBeNull();
    expect(parseTabSession(JSON.stringify({ version: 2, active: 0, tabs: [] }))).toBeNull();
    const partly = parseTabSession(JSON.stringify({
      version: 1,
      active: 5,
      tabs: [
        { entries: [], index: 0 },
        { entries: [{ pathname: "feed" }], index: 0 },
        { entries: [{ pathname: "/feed", search: "", hash: "" }], index: 3 },
        { entries: [{ pathname: "/music", search: "", hash: "" }], index: 0, title: null, parked: null },
      ],
    }));
    expect(partly?.tabs).toHaveLength(1);
    expect(partly?.active).toBe(0);
  });
});
