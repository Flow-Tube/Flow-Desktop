import { describe, expect, it } from "vitest";

import { applyVideoDetails, needsEnrichment } from "./playlistEnrichment";
import type { VideoDetails, VideoSummary } from "../types/video";

const video = (id: string, extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id,
  title: id,
  channelName: "chan",
  ...extra,
});

const details = (id: string, extra: Partial<VideoDetails> = {}): VideoDetails => ({
  id,
  title: "",
  channelName: "",
  ...extra,
});

const complete = { durationSeconds: 120, viewCountText: "1K views", publishedText: "2 days ago" };

describe("needsEnrichment", () => {
  it("flags a track missing a duration, view count, or publish date", () => {
    expect(needsEnrichment(video("full", complete))).toBe(false);
    expect(needsEnrichment(video("v", { ...complete, durationSeconds: null }))).toBe(true);
    expect(needsEnrichment(video("v", { ...complete, viewCountText: null }))).toBe(true);
    expect(needsEnrichment(video("v", { ...complete, publishedText: null }))).toBe(true);
  });

  it("treats a live stream as having its duration", () => {
    expect(needsEnrichment(video("live", { ...complete, durationSeconds: null, isLive: true })))
      .toBe(false);
  });
});

describe("applyVideoDetails", () => {
  it("replaces stored values with fresh ones", () => {
    const videos = [video("v", { durationSeconds: 300, viewCountText: "1K views" })];
    const refreshed = new Map([["v", details("v", { durationSeconds: 301, viewCountText: "2M views" })]]);

    const next = applyVideoDetails(videos, refreshed);

    expect(next[0]?.durationSeconds).toBe(301);
    expect(next[0]?.viewCountText).toBe("2M views");
  });

  it("keeps a stored value the fresh details lack", () => {
    const videos = [video("v", { durationSeconds: 300, publishedText: "2 days ago" })];
    const refreshed = new Map([["v", details("v", { viewCountText: "2M views" })]]);

    const next = applyVideoDetails(videos, refreshed);

    expect(next[0]?.title).toBe("v");
    expect(next[0]?.durationSeconds).toBe(300);
    expect(next[0]?.publishedText).toBe("2 days ago");
    expect(next[0]?.viewCountText).toBe("2M views");
  });

  it("returns the same array when nothing changes", () => {
    const videos = [video("v", complete), video("other")];
    const refreshed = new Map([["v", details("v", { durationSeconds: 120, viewCountText: "1K views" })]]);

    expect(applyVideoDetails(videos, refreshed)).toBe(videos);
  });
});
