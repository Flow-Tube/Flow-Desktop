import { describe, expect, it } from "vitest";
import { evidenceLabel } from "./useTasteOverview";

describe("evidenceLabel", () => {
  it("names how often an interest was watched", () => {
    expect(evidenceLabel(0)).toBe("taste_evidence_none");
    expect(evidenceLabel(2)).toBe("taste_evidence_once");
    expect(evidenceLabel(3)).toBe("taste_evidence_some");
    expect(evidenceLabel(8)).toBe("taste_evidence_often");
  });
});
