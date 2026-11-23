import { describe, expect, it, vi } from "vitest";

vi.mock("./i18n/index", async (actual) => ({
  ...(await actual<typeof import("./i18n/index")>()),
  APP_LOCALE: "de",
}));

import { formatPublishedText, formatYouTubeRelativeTime } from "./publishedDate";

const NOW = Date.UTC(2026, 10, 23, 12);
const DAY = 24 * 60 * 60 * 1000;

describe("dates in the app's language", () => {
  it("follows the app's language rather than the system's", () => {
    expect(formatYouTubeRelativeTime(NOW - 3 * DAY, NOW)).toBe("vor 3 Tagen");
    expect(formatYouTubeRelativeTime(NOW, NOW)).toBe("jetzt");
  });

  it("puts the relative time into the stream's string", () => {
    const video = { id: "dQw4w9WgXcQ", title: "", publishedText: "Streamed 1 hour ago", publishedAt: NOW - 60 * 60 * 1000 };
    expect(formatPublishedText(video as never, NOW + 2 * DAY)).toBe("Streamed vor 2 Tagen");
  });
});
