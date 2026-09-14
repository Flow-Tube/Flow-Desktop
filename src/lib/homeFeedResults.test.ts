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

  it("keeps the visible feed stable when a history refresh fully changes the ranking", () => {
    const visibleBeforeHistoryRefresh = [video("initial-a"), video("initial-b")];
    const rerankedFromImportedHistory = [video("history-a"), video("history-b")];

    expect(
      reconcileHomeFeedResults(visibleBeforeHistoryRefresh, rerankedFromImportedHistory).map(
        ({ id }) => id,
      ),
    ).toEqual(["initial-a", "initial-b", "history-a", "history-b"]);
  });

  it("does not create a new list when a late result contains nothing new", () => {
    const visible = [video("a"), video("b")];

    expect(reconcileHomeFeedResults(visible, [video("b"), video("a")])).toBe(visible);
  });

  it("uses the first validated result when nothing is visible yet", () => {
    const initial = [video("a"), video("b")];

    expect(reconcileHomeFeedResults([], initial)).toBe(initial);
  });

  it("keeps one copy of a video repeated inside the incoming feed", () => {
    const visible = [video("a")];
    const refreshed = [video("b"), video("b"), video("a")];

    expect(reconcileHomeFeedResults(visible, refreshed).map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("leaves hoisting to the caller rather than honouring the incoming order", () => {
    // The ranked feed puts fresh subscription uploads first. Reconciling cannot
    // honour that without reordering the visible feed, so Home composes them
    // back on top afterwards — see reconcileHomeFeedResults's module comment.
    const visible = [video("visible-a")];
    const rankedWithFreshSubFirst = [video("fresh-sub"), video("ranked-a")];

    expect(
      reconcileHomeFeedResults(visible, rankedWithFreshSubFirst).map(({ id }) => id),
    ).toEqual(["visible-a", "fresh-sub", "ranked-a"]);
  });
});
