import { describe, expect, it } from "vitest";

import { applyVideoMetadata, needsEnrichment } from "./playlistEnrichment";
import type { VideoMetadata, VideoSummary } from "../types/video";

const NOW = Date.UTC(2026, 9, 26, 12);

const video = (id: string, extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id,
  title: id,
  channelName: "chan",
  ...extra,
});

const metadata = (extra: Partial<VideoMetadata> = {}): VideoMetadata => ({
  title: "",
  channelName: "",
  isLive: false,
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

describe("applyVideoMetadata", () => {
  it("fills a stub with the length, exact views and exact upload time", () => {
    const uploaded = Date.UTC(2023, 9, 26, 12);
    const refreshed = new Map([["v", metadata({ durationSeconds: 213, viewCount: 1_830_673_075, publishedAtMs: uploaded })]]);

    const [next] = applyVideoMetadata([video("v")], refreshed, NOW);

    expect(next?.durationSeconds).toBe(213);
    expect(next?.viewCount).toBe(1_830_673_075);
    expect(next?.viewCountText).toBe("1.8B views");
    expect(next?.publishedAt).toBe(uploaded);
    expect(next?.publishedText).toBe("3 years ago");
    expect(next && needsEnrichment(next)).toBe(false);
  });

  it("keeps a stored value the metadata lacks", () => {
    const videos = [video("v", { durationSeconds: 300, publishedText: "2 days ago" })];
    const refreshed = new Map([["v", metadata({ viewCount: 2_000_000 })]]);

    const [next] = applyVideoMetadata(videos, refreshed, NOW);

    expect(next?.title).toBe("v");
    expect(next?.durationSeconds).toBe(300);
    expect(next?.publishedText).toBe("2 days ago");
    expect(next?.viewCountText).toBe("2M views");
  });

  it("marks a stream on air as live and one that has ended as not", () => {
    const live = applyVideoMetadata([video("l")], new Map([["l", metadata({ isLive: true })]]), NOW);
    expect(live[0]?.isLive).toBe(true);
    const ended = applyVideoMetadata([video("e", { isLive: true })], new Map([["e", metadata({ durationSeconds: 5400 })]]), NOW);
    expect(ended[0]?.isLive).toBe(false);
  });

  it("returns the same array when nothing changes", () => {
    const videos = [video("v", { ...complete, viewCount: 1000, viewCountText: "1K views" }), video("other")];
    const refreshed = new Map([["v", metadata({ durationSeconds: 120, viewCount: 1000 })]]);

    expect(applyVideoMetadata(videos, refreshed, NOW)).toBe(videos);
  });
});
