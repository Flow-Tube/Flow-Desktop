import { describe, expect, it } from "vitest";

import {
  formatPublishedText,
  formatYouTubeRelativeTime,
  parseRelativeToTimestamp,
  withPublishedAt,
} from "./publishedDate";
import type { VideoSummary } from "../types/video";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 26, 12);

const video = (publishedText: string | null, publishedAt?: number): VideoSummary => ({
  id: "v",
  title: "v",
  channelName: "chan",
  publishedText,
  publishedAt,
});

describe("parseRelativeToTimestamp", () => {
  it("reads YouTube's relative forms", () => {
    expect(parseRelativeToTimestamp("1 hour ago", NOW)).toBe(NOW - HOUR);
    expect(parseRelativeToTimestamp("3 days ago", NOW)).toBe(NOW - 3 * DAY);
    expect(parseRelativeToTimestamp("2 months ago", NOW)).toBe(NOW - 60 * DAY);
    expect(parseRelativeToTimestamp("Streamed 5 hours ago", NOW)).toBe(NOW - 5 * HOUR);
    expect(parseRelativeToTimestamp("yesterday", NOW)).toBe(NOW - DAY);
  });

  it("returns null for absolute dates and live text", () => {
    expect(parseRelativeToTimestamp("Jun 19, 2020", NOW)).toBeNull();
    expect(parseRelativeToTimestamp("Streamed live on Jun 19, 2020", NOW)).toBeNull();
    expect(parseRelativeToTimestamp("LIVE", NOW)).toBeNull();
  });
});

describe("formatYouTubeRelativeTime", () => {
  it("uses the largest whole unit", () => {
    expect(formatYouTubeRelativeTime(NOW - 90 * 60_000, NOW)).toBe("1 hour ago");
    expect(formatYouTubeRelativeTime(NOW - 10 * DAY, NOW)).toBe("1 week ago");
    expect(formatYouTubeRelativeTime(NOW - 400 * DAY, NOW)).toBe("1 year ago");
  });
});

describe("withPublishedAt", () => {
  it("pins relative text to the moment it is stored", () => {
    expect(withPublishedAt(video("1 hour ago"), NOW).publishedAt).toBe(NOW - HOUR);
  });

  it("keeps an earlier pinned timestamp when the same text is stored again later", () => {
    const pinned = video("1 hour ago", NOW - HOUR);
    expect(withPublishedAt(pinned, NOW + DAY)).toBe(pinned);
  });

  it("leaves absolute or missing text alone", () => {
    const absolute = video("Jun 19, 2020");
    expect(withPublishedAt(absolute, NOW)).toBe(absolute);
    expect(withPublishedAt(video(null), NOW).publishedAt).toBeUndefined();
  });
});

describe("formatPublishedText", () => {
  it("ages pinned text", () => {
    expect(formatPublishedText(video("1 hour ago", NOW - HOUR), NOW + 2 * DAY)).toBe("2 days ago");
    expect(formatPublishedText(video("Streamed 1 hour ago", NOW - HOUR), NOW + 2 * DAY))
      .toBe("Streamed 2 days ago");
  });

  it("shows text as given without a pinned timestamp or with an absolute date", () => {
    expect(formatPublishedText(video("1 hour ago"), NOW + 2 * DAY)).toBe("1 hour ago");
    expect(formatPublishedText(video("Jun 19, 2020", NOW - HOUR), NOW)).toBe("Jun 19, 2020");
  });
});
