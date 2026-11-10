import { describe, expect, it } from "vitest";
import { formatTimeAgo } from "./timeAgo";

describe("formatTimeAgo", () => {
  const now = 10 * 86_400_000;
  it("picks the unit that fits", () => {
    expect(formatTimeAgo(now - 5 * 60_000, now)).toMatch(/5/);
    expect(formatTimeAgo(now - 3 * 3_600_000, now)).toMatch(/3/);
    expect(formatTimeAgo(now - 4 * 86_400_000, now)).toMatch(/4/);
  });

  it("does not run backwards on a clock that moved", () => {
    expect(formatTimeAgo(now + 60_000, now)).toBe(formatTimeAgo(now, now));
  });
});
