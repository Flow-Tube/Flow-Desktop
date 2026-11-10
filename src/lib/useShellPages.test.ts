import { describe, expect, it, vi } from "vitest";

import { useTabsStore } from "../store/useTabsStore";
import type { DownloadProgress } from "./api/downloads";
import { downloadBadge, openShellRoute } from "./useShellPages";
import { FOCUS_SEARCH_EVENT } from "./windowEvents";

const item = (status: DownloadProgress["status"], downloadedBytes: number, totalBytes: number | null) =>
  ({ status, downloadedBytes, totalBytes }) as DownloadProgress;

describe("downloadBadge", () => {
  it("is empty with nothing running", () => {
    expect(downloadBadge([])).toEqual({ percent: null, count: 0, paused: false });
    expect(downloadBadge([item("completed", 10, 10), item("failed", 1, 10)]).count).toBe(0);
  });

  it("adds running downloads into one percentage", () => {
    expect(downloadBadge([item("downloading", 25, 100), item("muxing", 100, 100)])).toEqual({ percent: 62, count: 2, paused: false });
  });

  it("has no percentage while a size is unknown", () => {
    expect(downloadBadge([item("downloading", 25, 100), item("queued", 0, null)]).percent).toBeNull();
  });

  it("is paused only when all of them are", () => {
    expect(downloadBadge([item("paused", 1, 10), item("paused", 1, 10)]).paused).toBe(true);
    expect(downloadBadge([item("paused", 1, 10), item("downloading", 1, 10)]).paused).toBe(false);
  });
});

describe("openShellRoute", () => {
  it("puts the cursor in the search box instead of opening an empty results page", () => {
    const push = vi.spyOn(useTabsStore.getState(), "push");
    const focused = vi.fn();
    window.addEventListener(FOCUS_SEARCH_EVENT, focused);
    openShellRoute("/search");
    window.removeEventListener(FOCUS_SEARCH_EVENT, focused);
    expect(focused).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });
});
