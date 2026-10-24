import { describe, expect, it } from "vitest";

import { SLEEP_TIMER_PRESETS, fadeLevel, formatRemaining, parseCustomMinutes } from "./sleepTimer";

describe("sleep timer choices", () => {
  it("offers Android's presets", () => {
    expect([...SLEEP_TIMER_PRESETS]).toEqual([10, 15, 30, 45, 60, 90]);
  });

  it("takes a custom time of whole minutes from one minute to a day", () => {
    expect(parseCustomMinutes("25")).toBe(25);
    expect(parseCustomMinutes(" 1440 ")).toBe(1440);
    expect(parseCustomMinutes("0")).toBeNull();
    expect(parseCustomMinutes("1441")).toBeNull();
    expect(parseCustomMinutes("2.5")).toBeNull();
    expect(parseCustomMinutes("")).toBeNull();
    expect(parseCustomMinutes("ten")).toBeNull();
  });
});

describe("fadeLevel", () => {
  it("plays at full volume until the last 20 seconds, then fades to silence", () => {
    expect(fadeLevel(60)).toBe(1);
    expect(fadeLevel(20)).toBe(1);
    expect(fadeLevel(10)).toBe(0.5);
    expect(fadeLevel(0)).toBe(0);
    expect(fadeLevel(-3)).toBe(0);
  });
});

describe("formatRemaining", () => {
  it("shows minutes and seconds, and hours once there are any", () => {
    expect(formatRemaining(59_100)).toBe("1:00");
    expect(formatRemaining(9 * 60_000 + 5_000)).toBe("9:05");
    expect(formatRemaining(90 * 60_000)).toBe("1:30:00");
    expect(formatRemaining(-1)).toBe("0:00");
  });
});
