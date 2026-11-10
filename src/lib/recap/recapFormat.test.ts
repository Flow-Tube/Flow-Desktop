import { describe, expect, it } from "vitest";

import type { ActivityPattern } from "../api/recap";
import { deltaLabel, readyPeriod, scopeOf, spentTimeLabel, timeSeries } from "./recapFormat";

const activity = (dayMs: Record<string, number>): ActivityPattern => ({
  totalMs: 0,
  dayMs,
  hourCounts: [],
  weekdayCounts: [],
  activeDays: 0,
  longestStreak: 0,
  busiestDay: null,
});

describe("spentTimeLabel", () => {
  it("reads hours and minutes, or minutes alone", () => {
    expect(spentTimeLabel(125 * 60_000)).toBe("2 h 5 min");
    expect(spentTimeLabel(60_000)).toBe("1 min");
    expect(spentTimeLabel(30_000)).toBe("0 min");
  });
});

describe("scopeOf", () => {
  it("tells months, years and all time apart", () => {
    expect(scopeOf("2026-09")).toBe("month");
    expect(scopeOf("2026")).toBe("year");
    expect(scopeOf("all")).toBe("all");
  });
});

describe("deltaLabel", () => {
  it("compares with the time before when there is one", () => {
    expect(deltaLabel(120 * 60_000, 60 * 60_000)).toBe("1 h 0 min more than the time before");
    expect(deltaLabel(30 * 60_000, 60 * 60_000)).toBe("30 min less than the time before");
    expect(deltaLabel(100, 100)).toBe("About the same as the time before");
    expect(deltaLabel(100, null)).toBe("Time in Flow");
  });
});

describe("timeSeries", () => {
  it("gives a month one slot per day, to scale in minutes", () => {
    const series = timeSeries("2026-02", activity({ "2026-02-03": 120_000 }));
    expect(series.values).toHaveLength(28);
    expect(series.values[2]).toBe(2);
    expect(series.axis[0]).toBe("1");
    expect(series.axis[27]).toBe("28");
  });

  it("gives a year twelve slots and adds up its days", () => {
    const series = timeSeries("2026", activity({ "2026-03-01": 60_000, "2026-03-09": 60_000 }));
    expect(series.values).toHaveLength(12);
    expect(series.values[2]).toBe(2);
  });

  it("gives all time the twelve months up to the last active one", () => {
    const series = timeSeries("all", activity({ "2026-01-05": 60_000 }));
    expect(series.values).toHaveLength(12);
    expect(series.values[11]).toBe(1);
  });
});

describe("readyPeriod", () => {
  const months = (entries: Record<string, number>) => Object.entries(entries);

  it("offers the month that just closed once it holds enough", () => {
    const now = new Date(2026, 9, 3);
    expect(readyPeriod(months({ "2026-09": 20 }), null, now)).toBe("2026-09");
    expect(readyPeriod(months({ "2026-09": 19 }), null, now)).toBeNull();
    expect(readyPeriod(months({ "2026-09": 20 }), "2026-09", now)).toBeNull();
  });

  it("offers last year in January, then the closed month", () => {
    const now = new Date(2027, 0, 3);
    const data = months({ "2026-12": 50, "2026-05": 60 });
    expect(readyPeriod(data, null, now)).toBe("2026");
    expect(readyPeriod(data, "2026", now)).toBe("2026-12");
  });
});
