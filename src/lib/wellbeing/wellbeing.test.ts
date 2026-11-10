import { describe, expect, it } from "vitest";

import { bedtimeState, nextBedtimeAt, sleepWindowMs } from "./bedtime";
import { BreakClock } from "./breakClock";
import { weekIsEstimated, weekTotals } from "./useWatchTimeWeek";

const MINUTE = 60_000;

describe("BreakClock", () => {
  it("counts only the time Flow is in use", () => {
    const clock = new BreakClock();
    clock.onShown(0);
    clock.onHidden(10 * MINUTE);
    clock.onShown(11 * MINUTE);
    expect(clock.remainingMs(30 * MINUTE, 16 * MINUTE)).toBe(15 * MINUTE);
  });

  it("takes five minutes away as the break", () => {
    const clock = new BreakClock();
    clock.onShown(0);
    clock.onHidden(20 * MINUTE);
    clock.onShown(25 * MINUTE);
    expect(clock.remainingMs(30 * MINUTE, 25 * MINUTE)).toBe(30 * MINUTE);
  });

  it("never says less than nothing is left, and starts over when restarted", () => {
    const clock = new BreakClock();
    clock.onShown(0);
    expect(clock.remainingMs(30 * MINUTE, 90 * MINUTE)).toBe(0);
    clock.restart(90 * MINUTE);
    expect(clock.remainingMs(30 * MINUTE, 90 * MINUTE)).toBe(30 * MINUTE);
  });

  it("ignores being told the same thing twice", () => {
    const clock = new BreakClock();
    clock.onShown(0);
    clock.onShown(5 * MINUTE);
    clock.onHidden(10 * MINUTE);
    clock.onHidden(40 * MINUTE);
    expect(clock.remainingMs(30 * MINUTE, 41 * MINUTE)).toBe(20 * MINUTE);
  });
});

describe("nextBedtimeAt", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 8, 14, hour, minute).getTime();

  it("is today when the time is still ahead, tomorrow once it has passed", () => {
    expect(nextBedtimeAt("23:00", at(20))).toBe(at(23));
    expect(nextBedtimeAt("23:00", at(23))).toBe(new Date(2026, 8, 15, 23).getTime());
    expect(nextBedtimeAt("06:30", at(23))).toBe(new Date(2026, 8, 15, 6, 30).getTime());
  });

  it("refuses something that isn't a time", () => {
    expect(nextBedtimeAt("soon", at(20))).toBeNull();
    expect(nextBedtimeAt("25:00", at(20))).toBeNull();
  });
});

describe("bedtimeState", () => {
  it("waits, notifies at the time, and lets a morning wake-up pass quietly", () => {
    expect(bedtimeState(1000, 999)).toBe("wait");
    expect(bedtimeState(1000, 1000)).toBe("notify");
    expect(bedtimeState(0, 60 * MINUTE)).toBe("notify");
    expect(bedtimeState(0, 8 * 60 * MINUTE)).toBe("missed");
  });
});

describe("sleepWindowMs", () => {
  it("wraps past midnight", () => {
    expect(sleepWindowMs("23:00", "07:00")).toBe(8 * 60 * MINUTE);
    expect(sleepWindowMs("01:00", "07:30")).toBe(6.5 * 60 * MINUTE);
    expect(sleepWindowMs("bad", "07:00")).toBeNull();
  });
});

describe("the week's figures", () => {
  it("averages over all seven days", () => {
    const days: [string, number][] = [["2026-09-01", 700], ["2026-09-02", 0]];
    expect(weekTotals(days)).toEqual({ total: 700, dailyAverage: 100, empty: false });
    expect(weekTotals([["2026-09-01", 0]]).empty).toBe(true);
  });

  it("is an estimate while the ledger started inside the week", () => {
    const days: [string, number][] = [["2026-09-01", 0]];
    expect(weekIsEstimated({ days, startedAt: new Date(2026, 8, 3).getTime() })).toBe(true);
    expect(weekIsEstimated({ days, startedAt: new Date(2026, 7, 3).getTime() })).toBe(false);
  });
});
