import { describe, expect, it } from "vitest";
import { ALL_CHIP, RECENT_CHIP, chipToRestore, interestChipLabel } from "./useHomeChips";

const chess = { key: "chess", label: "Chess", topics: ["chess"], category: null, parts: [] };

describe("chipToRestore", () => {
  it("keeps a fixed chip and an interest that is still a chip", () => {
    expect(chipToRestore(RECENT_CHIP, [])).toBe(RECENT_CHIP);
    expect(chipToRestore("interest:chess", [chess])).toBe("interest:chess");
  });

  it("falls back to All when the interest left the chips", () => {
    expect(chipToRestore("interest:bread", [chess])).toBe(ALL_CHIP);
  });
});

describe("interestChipLabel", () => {
  it("names a theme after its category and any other chip after its topic", () => {
    expect(interestChipLabel(chess)).toBe("Chess");
    expect(interestChipLabel({ ...chess, key: "theme:gaming", category: "gaming" })).toBe("Gaming");
    expect(interestChipLabel({ ...chess, key: "theme:science", category: "science" })).toBe("Science & tech");
  });
});
