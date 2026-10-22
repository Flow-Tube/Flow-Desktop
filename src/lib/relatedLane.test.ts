import { describe, expect, it } from "vitest";
import type { RelatedContentItem } from "../types/video";
import { appendRelated, autoplayCandidates } from "./relatedLane";

const video = (id: string): RelatedContentItem => ({
  id,
  itemType: "video",
  title: `Video ${id}`,
  channelName: "Flow",
  videoId: id,
  playlistId: null,
  isMix: false,
});

describe("appendRelated", () => {
  it("adds only the items not already listed", () => {
    expect(appendRelated([video("a"), video("b")], [video("b"), video("c")]).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("autoplayCandidates", () => {
  it("moves YouTube's own pick to the front", () => {
    expect(autoplayCandidates([video("a"), video("b"), video("c")], "c").map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps the related order when the pick is not among them", () => {
    expect(autoplayCandidates([video("a"), video("b")], "z").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("falls back to the pick alone when no related video is left", () => {
    expect(autoplayCandidates([], "z")).toEqual([{ id: "z", title: "", channelName: "" }]);
    expect(autoplayCandidates([], null)).toEqual([]);
  });

  it("never offers a playlist or mix to autoplay", () => {
    const mix: RelatedContentItem = { ...video("m"), itemType: "mix", isMix: true, playlistId: "RDm" };
    expect(autoplayCandidates([mix, video("a")], null).map((item) => item.id)).toEqual(["a"]);
  });
});
