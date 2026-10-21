import { describe, expect, it } from "vitest";
import { ALL_CHIP, RECENT_CHIP, chipToRestore } from "./useHomeChips";

const chess = { key: "chess", label: "Chess", topics: ["chess"] };

describe("chipToRestore", () => {
  it("keeps a fixed chip and an interest that is still a chip", () => {
    expect(chipToRestore(RECENT_CHIP, [])).toBe(RECENT_CHIP);
    expect(chipToRestore("interest:chess", [chess])).toBe("interest:chess");
  });

  it("falls back to All when the interest left the chips", () => {
    expect(chipToRestore("interest:bread", [chess])).toBe(ALL_CHIP);
  });
});
