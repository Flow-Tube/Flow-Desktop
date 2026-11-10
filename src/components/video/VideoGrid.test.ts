import { describe, expect, it, vi } from "vitest";

vi.mock("./VideoCard", () => ({ VideoCard: () => null }));

import { insertAfterCard } from "./VideoGrid";

describe("insertAfterCard", () => {
  it("follows the first row of a measured grid", () => {
    expect(insertAfterCard(true, 4, 10)).toBe(3);
    expect(insertAfterCard(true, 4, 2)).toBe(1);
  });

  it("waits for a grid to be measured, and for a slot to exist", () => {
    expect(insertAfterCard(true, 0, 10)).toBe(-1);
    expect(insertAfterCard(false, 4, 10)).toBe(-1);
  });
});
