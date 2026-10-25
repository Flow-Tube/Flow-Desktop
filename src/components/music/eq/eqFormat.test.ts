import { describe, expect, it } from "vitest";

import { formatDb, formatFrequency } from "./eqFormat";

describe("eqFormat", () => {
  it("labels frequencies the way EQ axes do", () => {
    expect(formatFrequency(31)).toBe("31");
    expect(formatFrequency(1_000)).toBe("1k");
    expect(formatFrequency(2_500)).toBe("2.5k");
    expect(formatFrequency(16_000)).toBe("16k");
  });

  it("signs gains and drops a negative zero", () => {
    expect(formatDb(3)).toBe("+3");
    expect(formatDb(-1.5)).toBe("-1.5");
    expect(formatDb(-0.04)).toBe("0");
  });
});
