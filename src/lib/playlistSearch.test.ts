import { describe, expect, it } from "vitest";

import { filterVideosBySearch } from "./playlistSearch";
import type { VideoSummary } from "../types/video";

const video = (id: string, title: string, channelName = "chan"): VideoSummary => ({ id, title, channelName });

describe("filterVideosBySearch", () => {
  const videos = [video("a", "Café jazz mix", "Night Radio"), video("b", "Rock anthems", "Jazz Hands"), video("c", "Lo-fi")];

  it("returns the same list when the query is blank", () => {
    expect(filterVideosBySearch(videos, "   ")).toBe(videos);
  });

  it("matches title and channel, ignoring case and accents", () => {
    expect(filterVideosBySearch(videos, "CAFE").map((v) => v.id)).toEqual(["a"]);
    expect(filterVideosBySearch(videos, "jazz").map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("needs every word to match", () => {
    expect(filterVideosBySearch(videos, "jazz radio").map((v) => v.id)).toEqual(["a"]);
  });
});
