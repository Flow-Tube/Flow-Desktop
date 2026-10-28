import { describe, expect, it } from "vitest";
import { tabIconFor } from "./tabPage";

describe("tabIconFor", () => {
  it("uses the video, channel, Shorts and search pictures", () => {
    expect(tabIconFor("/watch/abc123")).toEqual({ kind: "video", videoId: "abc123" });
    expect(tabIconFor("/channel/UC1")).toEqual({ kind: "channel", channelId: "UC1" });
    expect(tabIconFor("/shorts/xyz")).toEqual({ kind: "shorts" });
    expect(tabIconFor("/search")).toEqual({ kind: "search" });
  });

  it("uses the matching rail icon for sections and their sub-pages", () => {
    expect(tabIconFor("/feed")).toEqual({ kind: "nav", name: "feed" });
    expect(tabIconFor("/music/album/1")).toEqual({ kind: "nav", name: "music" });
    expect(tabIconFor("/playlists")).toEqual({ kind: "nav", name: "playlists" });
    expect(tabIconFor("/playlist/PL1")).toEqual({ kind: "nav", name: "playlists" });
    expect(tabIconFor("/settings/diagnostics")).toEqual({ kind: "nav", name: "settings" });
  });

  it("falls back to Home", () => {
    expect(tabIconFor("/")).toEqual({ kind: "nav", name: "home" });
    expect(tabIconFor("/unknown")).toEqual({ kind: "nav", name: "home" });
  });
});
