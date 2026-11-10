import { describe, expect, it } from "vitest";
import { BackendApiError } from "./api/errors";
import { exploreErrorKey, shelvesWithShorts } from "./useExplore";
import type { ExploreShelf } from "../types/video";

describe("exploreErrorKey", () => {
  it("names YouTube's limit apart from any other failure", () => {
    expect(exploreErrorKey(new BackendApiError("limited", "rateLimited", null))).toBe("explore_rate_limited");
    expect(exploreErrorKey({ message: "limited", kind: "rateLimited" })).toBe("explore_rate_limited");
    expect(exploreErrorKey(new BackendApiError("down", "network", null))).toBe("explore_load_error");
  });
});

describe("shelvesWithShorts", () => {
  const video = (id: string, isShort: boolean) => ({ id, title: id, channelName: "", isShort });
  const shelf = (title: string, videos: ExploreShelf["videos"]): ExploreShelf => ({ title, videos });

  it("takes Shorts out and drops a shelf left empty", () => {
    const shelves = [shelf("Mixed", [video("a", true), video("b", false)]), shelf("Reels", [video("c", true)])];
    expect(shelvesWithShorts(shelves, false)).toEqual([shelf("Mixed", [video("b", false)])]);
    expect(shelvesWithShorts(shelves, true)).toBe(shelves);
  });
});
