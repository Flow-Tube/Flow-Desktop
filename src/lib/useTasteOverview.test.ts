import { describe, expect, it } from "vitest";
import { evidenceLabel, hiddenChannelOrder } from "./useTasteOverview";

describe("evidenceLabel", () => {
  it("names how often an interest was watched", () => {
    expect(evidenceLabel(0)).toBe("taste_evidence_none");
    expect(evidenceLabel(2)).toBe("taste_evidence_once");
    expect(evidenceLabel(3)).toBe("taste_evidence_some");
    expect(evidenceLabel(8)).toBe("taste_evidence_often");
  });
});

describe("hiddenChannelOrder", () => {
  it("lists named channels by name, then the unnamed ones by id", () => {
    const order = hiddenChannelOrder([
      { id: "UC2", name: "" },
      { id: "UC1", name: "Zeta" },
      { id: "UC3", name: "Alpha" },
    ]);
    expect(order.map((c) => c.id)).toEqual(["UC3", "UC1", "UC2"]);
  });
});
