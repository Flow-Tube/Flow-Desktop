import { beforeEach, describe, expect, it, vi } from "vitest";

const getWatchProgress = vi.fn();
vi.mock("../lib/api/db", () => ({
  getWatchProgress: () => getWatchProgress(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
}));

import { progressPercent, startWatchProgress, useWatchProgressStore } from "./useWatchProgressStore";
import { HISTORY_UPDATED_EVENT } from "./useHistoryStore";
import { WATCH_HISTORY_WRITTEN_EVENT, announceWatchHistoryWrite, type WatchHistoryWrite } from "../lib/windowEvents";

const percent = (videoId: string) => progressPercent(useWatchProgressStore.getState().progress.get(videoId));
const record = (videoId: string, watchedSeconds: number, totalSeconds: number, skipped = false): WatchHistoryWrite => ({
  kind: "record",
  videoId,
  watchedSeconds,
  totalSeconds,
  skipped,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("progressPercent", () => {
  it("follows Android's card rule", () => {
    expect(progressPercent(undefined)).toBe(0);
    expect(progressPercent({ watchedSeconds: 17, totalSeconds: 600 })).toBe(0);
    expect(progressPercent({ watchedSeconds: 18, totalSeconds: 600 })).toBe(3);
    expect(progressPercent({ watchedSeconds: 259, totalSeconds: 600 })).toBe(43);
    expect(progressPercent({ watchedSeconds: 539, totalSeconds: 600 })).toBe(90);
    expect(progressPercent({ watchedSeconds: 540, totalSeconds: 600 })).toBe(100);
    expect(progressPercent({ watchedSeconds: 40, totalSeconds: 0 })).toBe(0);
  });
});

describe("useWatchProgressStore", () => {
  beforeEach(() => {
    getWatchProgress.mockReset().mockResolvedValue([]);
    useWatchProgressStore.setState({ progress: new Map() });
  });

  it("loads the rows that show a bar", async () => {
    getWatchProgress.mockResolvedValue([
      ["half", 300, 600],
      ["peek", 5, 600],
    ]);
    await useWatchProgressStore.getState().load();
    expect(percent("half")).toBe(50);
    expect(useWatchProgressStore.getState().progress.has("peek")).toBe(false);
  });

  it("follows a write and keeps the same map when nothing changed", () => {
    const { apply } = useWatchProgressStore.getState();
    apply(record("v", 120, 600));
    const after = useWatchProgressStore.getState().progress;
    expect(percent("v")).toBe(20);
    apply(record("v", 120, 600));
    expect(useWatchProgressStore.getState().progress).toBe(after);
    apply(record("v", 590, 600));
    expect(percent("v")).toBe(100);
  });

  it("drops a video that was cleared, removed, or is a song or a Short", () => {
    const { apply } = useWatchProgressStore.getState();
    for (const id of ["cleared", "removed", "song", "length lost"]) apply(record(id, 300, 600));
    apply(record("cleared", 0, 600));
    apply({ kind: "removed", videoId: "removed" });
    apply(record("song", 300, 600, true));
    apply(record("length lost", 0, 0));
    expect(useWatchProgressStore.getState().progress.size).toBe(0);
  });

  it("replays a write that lands while a load reads the older rows", async () => {
    let answer: (rows: unknown) => void = () => {};
    getWatchProgress.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const loading = useWatchProgressStore.getState().load();
    useWatchProgressStore.getState().apply(record("playing", 400, 600));
    answer([["playing", 300, 600]]);
    await loading;
    expect(percent("playing")).toBe(67);
  });

  it("follows this window's writes and reloads when history is rewritten", async () => {
    const stop = startWatchProgress();
    await flush();
    announceWatchHistoryWrite(record("v", 300, 600));
    expect(percent("v")).toBe(50);

    getWatchProgress.mockResolvedValue([["synced", 60, 600]]);
    window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT));
    await flush();
    expect(percent("synced")).toBe(10);
    expect(percent("v")).toBe(0);

    stop();
    window.dispatchEvent(new CustomEvent(WATCH_HISTORY_WRITTEN_EVENT, { detail: record("after", 300, 600) }));
    expect(percent("after")).toBe(0);
  });
});
