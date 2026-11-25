import { describe, expect, it } from "vitest";
import { channelsByNewestUpload, channelsOfKind, reorderedManualOrder, sortSubscriptions } from "./subscriptionSort";
import type { VideoSummary } from "../types/video";

const channels = [
  { id: "b", name: "Beta" },
  { id: "a", name: "alpha" },
  { id: "c", name: "Gamma", isMusic: true },
];
const video = (channelId: string) => ({ id: channelId, title: "", channelName: "", channelId }) as VideoSummary;

describe("sortSubscriptions", () => {
  it("keeps the stored order by default", () => {
    expect(sortSubscriptions(channels, "")).toBe(channels);
  });

  it("sorts by name, whatever the case", () => {
    expect(sortSubscriptions(channels, "name").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the channel with the latest upload first and the silent last", () => {
    const newestFirst = channelsByNewestUpload([video("c"), video("b"), video("c")]);
    expect(newestFirst).toEqual(["c", "b"]);
    expect(sortSubscriptions(channels, "recent", { newestFirst }).map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("keeps the stored order for recent when no feed has been read yet", () => {
    expect(sortSubscriptions(channels, "recent").map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

describe("manual order", () => {
  it("follows the dragged order and puts channels it doesn't name last, in follow order", () => {
    const sorted = sortSubscriptions(channels, "manual", { manualOrder: ["c", "gone", "b"] });
    expect(sorted.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });
});

describe("reorderedManualOrder", () => {
  it("gives every channel a place and moves only the shown ones", () => {
    // Stored order names only c; a and b were followed later and show after it.
    const next = reorderedManualOrder([{ id: "a" }, { id: "b" }, { id: "c" }], ["c"], ["b", "c"]);
    expect(next).toEqual(["b", "a", "c"]);
  });
});

describe("channelsOfKind", () => {
  it("splits video channels from music ones", () => {
    expect(channelsOfKind(channels, "music").map((c) => c.id)).toEqual(["c"]);
    expect(channelsOfKind(channels, "video").map((c) => c.id)).toEqual(["b", "a"]);
  });
});
