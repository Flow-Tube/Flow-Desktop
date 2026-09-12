import { describe, expect, it } from "vitest";

import type { VideoSummary } from "../types/video";
import { reconcileHomeFeedResults } from "./homeFeedResults";

const video = (id: string) => ({ id, title: id }) as VideoSummary;

describe("reconcileHomeFeedResults", () => {
  it("keeps the visible feed in place and appends only new ranked videos", () => {
    const visible = [video("starter-a"), video("starter-b")];
    const refreshed = [video("fresh-a"), video("starter-a"), video("fresh-b")];

    expect(reconcileHomeFeedResults(visible, refreshed).map(({ id }) => id)).toEqual([
      "starter-a",
      "starter-b",
      "fresh-a",
      "fresh-b",
    ]);
  });

  it("does not create a new list when a late result contains nothing new", () => {
    const visible = [video("a"), video("b")];

    expect(reconcileHomeFeedResults(visible, [video("b"), video("a")])).toBe(visible);
  });

  it("uses the first validated result when nothing is visible yet", () => {
    const initial = [video("a"), video("b")];

    expect(reconcileHomeFeedResults([], initial)).toBe(initial);
  });
});
