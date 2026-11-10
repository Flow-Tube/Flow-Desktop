import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getWatchHistory = vi.fn();
vi.mock("./api/db", () => ({
  getWatchHistory: (limit: number, offset: number) => getWatchHistory(limit, offset),
  clearWatchHistory: vi.fn(),
  deleteShortWatchRecords: vi.fn(),
  deleteWatchRecord: vi.fn(),
  restoreWatchRecord: vi.fn(),
}));

const { getHistoryDateLabel, mapHistoryRecordToVideo, useHistory } = await import("./useHistory");

const row = (videoId: string) => ({
  videoId,
  title: videoId,
  watchDate: "2026-11-06T12:00:00.000Z",
  watchDurationSeconds: 30,
  totalDurationSeconds: 60,
});

function Page() {
  const { history } = useHistory();
  return createElement("p", null, history.map((item) => item.videoId).join(","));
}

async function visit() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(Page)));
  const shown = host.textContent;
  act(() => root.unmount());
  return shown;
}

describe("useHistory", () => {
  it("shows a video watched between two visits", async () => {
    getWatchHistory.mockResolvedValue([row("first")]);
    expect(await visit()).toBe("first");

    getWatchHistory.mockResolvedValue([row("second"), row("first")]);
    expect(await visit()).toBe("second,first");
  });
});

describe("history labels", () => {
  const now = new Date(2026, 10, 6, 12);

  it("names recent days and falls back for a date it can't read", () => {
    expect(getHistoryDateLabel(new Date(2026, 10, 6, 1).toISOString(), now)).toBe("Today");
    expect(getHistoryDateLabel(new Date(2026, 10, 5, 23).toISOString(), now)).toBe("Yesterday");
    expect(getHistoryDateLabel(new Date(2026, 10, 3).toISOString(), now)).toBe("This week");
    expect(getHistoryDateLabel("nonsense", now)).toBe("Recently");
  });

  it("gives the card its progress and no made-up view count", () => {
    const video = mapHistoryRecordToVideo(row("a"));
    expect(video.watchProgressPercent).toBe(50);
    expect(video.viewCountText).toBeUndefined();
  });
});
