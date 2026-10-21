import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api/db", () => ({ addWatchRecord: vi.fn(() => Promise.resolve()) }));
vi.mock("./deepFlow", () => ({ shouldRecordWatchHistory: () => true }));
vi.mock("./api/shorts", () => ({
  reportShortView: vi.fn(() => Promise.resolve()),
  recordSeenShorts: vi.fn(() => Promise.resolve()),
}));

import { addWatchRecord } from "./api/db";
import { recordSeenShorts, reportShortView } from "./api/shorts";
import {
  SEEN_SHORT_DWELL_MS,
  finishShortView,
  noteShortEnded,
  noteShortProgress,
  startShortView,
} from "./shortViews";
import type { ShortItem } from "../types/shorts";

const short = (id: string): ShortItem => ({
  id,
  title: `Short ${id}`,
  channelName: "Channel",
  channelId: "UC1",
  thumbnailUrl: "",
});

describe("shortViews", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reportShortView).mockClear();
    vi.mocked(recordSeenShorts).mockClear();
    vi.mocked(addWatchRecord).mockClear();
  });
  afterEach(() => {
    finishShortView();
    vi.useRealTimers();
  });

  it("reports one viewing when the next Short starts", () => {
    startShortView(short("a"));
    noteShortProgress("a", 4000, 30000);
    noteShortProgress("a", 6000, 30000);
    startShortView(short("b"));
    expect(reportShortView).toHaveBeenCalledTimes(1);
    expect(reportShortView).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "a", positionMs: 6000, durationMs: 30000, completed: false }),
    );
  });

  it("counts a loop or an end as played out", () => {
    startShortView(short("a"));
    noteShortProgress("a", 29500, 30000);
    noteShortProgress("a", 200, 30000);
    finishShortView();
    expect(reportShortView).toHaveBeenLastCalledWith(expect.objectContaining({ completed: true }));

    startShortView(short("b"));
    noteShortProgress("b", 1000, 20000);
    noteShortEnded("b");
    finishShortView();
    expect(reportShortView).toHaveBeenLastCalledWith(
      expect.objectContaining({ videoId: "b", completed: true }),
    );
  });

  it("saves a Short to history unless it was flicked past", () => {
    startShortView(short("a"));
    noteShortProgress("a", 1500, 30000);
    startShortView(short("b"));
    noteShortProgress("b", 8000, 30000);
    finishShortView();
    expect(addWatchRecord).toHaveBeenCalledTimes(1);
    expect(addWatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "b", watchDurationSeconds: 8, totalDurationSeconds: 30 }),
    );
  });

  it("ignores progress from another Short and a Short that never played", () => {
    startShortView(short("a"));
    noteShortProgress("z", 5000, 30000);
    finishShortView();
    expect(reportShortView).not.toHaveBeenCalled();
  });

  it("marks a Short seen only once it stayed on screen", () => {
    startShortView(short("a"));
    vi.advanceTimersByTime(SEEN_SHORT_DWELL_MS - 1);
    startShortView(short("b"));
    vi.advanceTimersByTime(SEEN_SHORT_DWELL_MS);
    expect(recordSeenShorts).toHaveBeenCalledTimes(1);
    expect(recordSeenShorts).toHaveBeenCalledWith(["b"]);
  });
});
