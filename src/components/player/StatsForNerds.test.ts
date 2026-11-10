import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/clipboard", () => ({ copyText: vi.fn() }));
const { statsAsText } = await import("./StatsForNerds");

describe("statsAsText", () => {
  it("copies one row per line", () => {
    expect(statsAsText([["Video ID", "abc"], ["Speed", "1x"]])).toBe("Video ID: abc\nSpeed: 1x");
  });
});
