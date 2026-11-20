import { describe, expect, it } from "vitest";

import { pinchColumns } from "./pinchGrid";

describe("pinchColumns", () => {
  it("drops a column when the fingers spread far enough, and adds one when they close", () => {
    expect(pinchColumns(4, 1.2)).toEqual({ columns: 4, scale: 1.2 });
    expect(pinchColumns(4, 1.35)).toEqual({ columns: 3, scale: 1 });
    expect(pinchColumns(4, 0.7)).toEqual({ columns: 5, scale: 1 });
  });

  it("stays between 2 and 8 columns", () => {
    expect(pinchColumns(2, 2).columns).toBe(2);
    expect(pinchColumns(8, 0.5).columns).toBe(8);
  });
});
