import { describe, expect, it } from "vitest";
import { recentUploadsPerChannel } from "./useSubscriptionFeed";

describe("recentUploadsPerChannel", () => {
  it("keeps the first six uploads of each channel and drops ones without a channel", () => {
    const videos = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, title: "a", channelName: "A", channelId: "UCa" })),
      { id: "b0", title: "b", channelName: "B", channelId: "UCb" },
      { id: "x", title: "x", channelName: "X" },
    ];
    const kept = recentUploadsPerChannel(videos);
    expect(kept.filter((video) => video.channelId === "UCa")).toHaveLength(6);
    expect(kept.map((video) => video.id)).toContain("b0");
    expect(kept.map((video) => video.id)).not.toContain("x");
  });
});
