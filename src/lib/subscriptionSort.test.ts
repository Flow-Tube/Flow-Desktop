import { describe, expect, it } from "vitest";
import { channelsOfKind, sortSubscriptions } from "./subscriptionSort";
import type { VideoSummary } from "../types/video";

const channels = [
  { id: "b", name: "Beta" },
  { id: "a", name: "alpha" },
  { id: "c", name: "Gamma", isMusic: true },
];
const video = (channelId: string) => ({ id: channelId, title: "", channelName: "", channelId }) as VideoSummary;

describe("sortSubscriptions", () => {
  it("keeps the stored order by default", () => {
    expect(sortSubscriptions(channels, "", [])).toBe(channels);
  });

  it("sorts by name, whatever the case", () => {
    expect(sortSubscriptions(channels, "name", []).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the channel with the latest upload first and the silent last", () => {
    const sorted = sortSubscriptions(channels, "recent", [video("c"), video("b"), video("c")]);
    expect(sorted.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });
});

describe("channelsOfKind", () => {
  it("splits video channels from music ones", () => {
    expect(channelsOfKind(channels, "music").map((c) => c.id)).toEqual(["c"]);
    expect(channelsOfKind(channels, "video").map((c) => c.id)).toEqual(["b", "a"]);
  });
});
