import { describe, expect, it } from "vitest";
import { REARM_MARGIN_SECONDS, segmentsToRearm } from "./sponsorBlockRearm";

const segments: Array<{ UUID: string; segment: [number, number] }> = [
  { UUID: "early", segment: [10, 20] },
  { UUID: "late", segment: [100, 120] },
];

describe("segmentsToRearm", () => {
  it("re-arms every segment playback has rewound before", () => {
    expect(segmentsToRearm(segments, 5).map((s) => s.UUID)).toEqual(["early", "late"]);
    expect(segmentsToRearm(segments, 50).map((s) => s.UUID)).toEqual(["late"]);
  });

  it("leaves a segment alone inside it and just past it", () => {
    expect(segmentsToRearm(segments, 15).map((s) => s.UUID)).toEqual(["late"]);
    expect(segmentsToRearm(segments, 125)).toEqual([]);
  });

  it("doesn't re-arm a seek that lands just short of the segment", () => {
    expect(segmentsToRearm(segments, 10 - REARM_MARGIN_SECONDS)).toHaveLength(1);
    expect(segmentsToRearm(segments, 10 - REARM_MARGIN_SECONDS - 0.01)).toHaveLength(2);
  });
});
