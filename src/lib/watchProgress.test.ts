import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ addWatchRecord: vi.fn(), getWatchHistory: vi.fn() }));
vi.mock("./api/db", () => db);
vi.mock("../store/useHistoryStore", () => ({ HISTORY_UPDATED_EVENT: "history-updated" }));

import { profileStorage } from "./storage/profileStorage";
import { clearWatchProgress } from "./watchProgress";

const record = {
  videoId: "v",
  title: "t",
  watchDate: "2026-11-01T00:00:00Z",
  watchDurationSeconds: 590,
  totalDurationSeconds: 600,
};

describe("clearWatchProgress", () => {
  beforeEach(() => {
    db.addWatchRecord.mockReset().mockResolvedValue(undefined);
    db.getWatchHistory.mockReset();
  });

  it("zeroes the history row, keeps the entry and drops the resume point", async () => {
    db.getWatchHistory.mockResolvedValue([record]);
    profileStorage.setItem("flow_watch_progress:v", "{}");
    const heard = vi.fn();
    window.addEventListener("history-updated", heard);
    await clearWatchProgress("v");
    window.removeEventListener("history-updated", heard);
    expect(db.addWatchRecord).toHaveBeenCalledWith({ ...record, watchDurationSeconds: 0 });
    expect(profileStorage.getItem("flow_watch_progress:v")).toBeNull();
    expect(heard).toHaveBeenCalledOnce();
  });

  it("writes nothing for a video history does not hold", async () => {
    db.getWatchHistory.mockResolvedValue([]);
    await clearWatchProgress("v");
    expect(db.addWatchRecord).not.toHaveBeenCalled();
  });
});
