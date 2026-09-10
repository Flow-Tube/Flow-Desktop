import { describe, expect, it } from "vitest";

import { matchBlockedKeyword, normalizeKeyword } from "./useFeedActionsStore";
import type { VideoSummary } from "../types/video";

function video(title: string, channelName = "Some Channel"): VideoSummary {
  return { id: "abc", title, channelName };
}

describe("matchBlockedKeyword", () => {
  it("returns null when nothing is blocked", () => {
    expect(matchBlockedKeyword(video("Rust in 100 seconds"), [])).toBeNull();
  });

  it("matches a single word on word boundaries only", () => {
    expect(matchBlockedKeyword(video("Ass kicking gameplay"), ["ass"])).toBe("ass");
    expect(matchBlockedKeyword(video("A class on compilers"), ["ass"])).toBeNull();
  });

  it("matches a phrase anywhere in the title", () => {
    expect(matchBlockedKeyword(video("Reacting to the finale"), ["reacting to"])).toBe("reacting to");
  });

  it("matches the channel name as well as the title", () => {
    expect(matchBlockedKeyword(video("A video", "Drama Alert"), ["drama"])).toBe("drama");
  });

  it("ignores case on both sides", () => {
    expect(matchBlockedKeyword(video("SPOILERS ahead"), [normalizeKeyword("  Spoilers ")])).toBe(
      "spoilers",
    );
  });

  it("matches non-ascii words on boundaries", () => {
    expect(matchBlockedKeyword(video("新しい 動画 です"), ["動画"])).toBe("動画");
  });

  it("returns the first matching keyword", () => {
    expect(matchBlockedKeyword(video("Spoilers and drama"), ["drama", "spoilers"])).toBe("drama");
  });
});
