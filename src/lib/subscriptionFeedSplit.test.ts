import { describe, expect, it } from "vitest";
import { splitSubscriptionFeed, type SubscriptionFeedSections } from "./subscriptionFeedSplit";
import type { VideoSummary } from "../types/video";

const sections: SubscriptionFeedSections = {
  showShorts: true,
  showLive: true,
  showVideos: true,
  excludedShortChannels: new Set(),
  finishedShorts: new Set(),
};
const video = (id: string, extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id,
  title: id,
  channelName: "c",
  channelId: "c",
  ...extra,
});
const ids = (split: ReturnType<typeof splitSubscriptionFeed>) => ({
  shorts: split.shortsForShelf.map((s) => s.id),
  regular: split.regularVideos.map((v) => v.id),
});

describe("splitSubscriptionFeed", () => {
  const feed = [video("s", { isShort: true }), video("v"), video("l", { isLive: true })];

  it("sorts Shorts, videos and live into their places", () => {
    expect(ids(splitSubscriptionFeed(feed, sections))).toEqual({ shorts: ["s"], regular: ["v", "l"] });
  });

  it("follows each section's switch", () => {
    expect(ids(splitSubscriptionFeed(feed, { ...sections, showShorts: false })).shorts).toEqual([]);
    expect(ids(splitSubscriptionFeed(feed, { ...sections, showLive: false })).regular).toEqual(["v"]);
    expect(ids(splitSubscriptionFeed(feed, { ...sections, showVideos: false })).regular).toEqual(["l"]);
    expect(
      ids(splitSubscriptionFeed(feed, { ...sections, excludedShortChannels: new Set(["c"]) })).shorts,
    ).toEqual([]);
  });

  it("leaves nothing to show when every Short is finished, so the page shows its empty state", () => {
    const split = splitSubscriptionFeed([video("s", { isShort: true })], { ...sections, finishedShorts: new Set(["s"]) });
    expect(ids(split)).toEqual({ shorts: [], regular: [] });
  });
});
