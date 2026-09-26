import { describe, expect, it } from "vitest";

import {
  formatPublishedText,
  formatYouTubeRelativeTime,
  parseRelativeToTimestamp,
  parseToTimestamp,
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

describe("parseToTimestamp", () => {
  it("reads absolute dates as local midnight", () => {
    const expected = new Date(2020, 5, 19).getTime();
    expect(parseToTimestamp("Jun 19, 2020")).toBe(expected);
    expect(parseToTimestamp("19 Jun 2020")).toBe(expected);
    expect(parseToTimestamp("2020-06-19")).toBe(expected);
    expect(parseToTimestamp("Streamed live on Jun 19, 2020")).toBe(expected);
  });

  it("falls back to relative text", () => {
    expect(parseToTimestamp("3 days ago", NOW)).toBe(NOW - 3 * DAY);
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

  it("pins an absolute date, keeping a stored time from the same day", () => {
    expect(withPublishedAt(video("Jun 19, 2020"), NOW).publishedAt).toBe(new Date(2020, 5, 19).getTime());
    const sameDay = new Date(2020, 5, 19, 15).getTime();
    const pinned = video("Jun 19, 2020", sameDay);
    expect(withPublishedAt(pinned, NOW)).toBe(pinned);
  });

  it("leaves missing and live text alone", () => {
    expect(withPublishedAt(video(null), NOW).publishedAt).toBeUndefined();
    expect(withPublishedAt(video("LIVE"), NOW).publishedAt).toBeUndefined();
  });
});

describe("formatPublishedText", () => {
  it("ages pinned text", () => {
    expect(formatPublishedText(video("1 hour ago", NOW - HOUR), NOW + 2 * DAY)).toBe("2 days ago");
    expect(formatPublishedText(video("Streamed 1 hour ago", NOW - HOUR), NOW + 2 * DAY))
      .toBe("Streamed 2 days ago");
  });

  it("shows an absolute date as its age", () => {
    const published = new Date(2026, 8, 13).getTime();
    expect(formatPublishedText(video("Sep 13, 2026", published), published + 13 * DAY)).toBe("1 week ago");
  });

  it("shows text as given without a pinned timestamp, and live text", () => {
    expect(formatPublishedText(video("1 hour ago"), NOW + 2 * DAY)).toBe("1 hour ago");
    expect(formatPublishedText(video("Sep 13, 2026"), NOW)).toBe("Sep 13, 2026");
    expect(formatPublishedText(video("LIVE", NOW - HOUR), NOW)).toBe("LIVE");
  });
});
