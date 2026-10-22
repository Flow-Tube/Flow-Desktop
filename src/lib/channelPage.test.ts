import { describe, expect, it } from "vitest";
import type { ChannelItem, ChannelSection, ChannelTab } from "../types/video";
import { mergeChannelItems, sectionLayout, tabForSection, visibleTabs } from "./channelPage";

const video = (id: string): ChannelItem => ({ type: "video", id, title: id, channelName: "C" });
const short = (id: string): ChannelItem => ({ type: "short", id, title: id });
const tab = (kind: string, params?: string): ChannelTab => ({ kind, title: kind, params, selected: false });

describe("channel page", () => {
  it("shows only tabs it can render and load", () => {
    const tabs = [tab("home"), tab("videos", "V"), tab("store", "S"), tab("posts"), tab("unknown", "U")];
    expect(visibleTabs(tabs).map((t) => t.kind)).toEqual(["home", "videos"]);
  });

  it("lays a shelf out by most of its items", () => {
    const section: ChannelSection = { title: "S", items: [short("a"), short("b"), video("c")], isTrailer: false };
    expect(sectionLayout(section)).toBe("shorts");
  });

  it("does not repeat items a further page sends again", () => {
    expect(mergeChannelItems([video("a"), video("b")], [video("b"), video("c")]).map((i) => i.type === "video" && i.id))
      .toEqual(["a", "b", "c"]);
  });

  it("sends See all to the tab of the shelf's params, else to one of its layout", () => {
    const tabs = [tab("home"), tab("videos", "V"), tab("shorts", "S")];
    const popular: ChannelSection = { title: "Popular", items: [video("a")], more: { params: "POP" }, isTrailer: false };
    expect(tabForSection(popular, tabs)?.kind).toBe("videos");
    const shorts: ChannelSection = { title: "Shorts", items: [short("a")], more: { params: "S" }, isTrailer: false };
    expect(tabForSection(shorts, tabs)?.kind).toBe("shorts");
    expect(tabForSection({ ...popular, more: null }, tabs)).toBeUndefined();
  });
});
