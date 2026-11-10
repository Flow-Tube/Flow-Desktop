import { describe, expect, it } from "vitest";
import {
  commentSortFor,
  firstTimestampSeconds,
  oldestCommentsFirst,
  timedAnchorIndex,
  timedCommentOrders,
  timedCommentsInOrder,
} from "./commentFilters";
import type { Comment, RichSpan } from "../types/video";

const stamp = (start: number, seconds: number): RichSpan => ({ start, length: 4, target: { kind: "timestamp", seconds } });
const comment = (id: string, extra: Partial<Comment> = {}, spans: RichSpan[] = []): Comment => ({
  id,
  author: "a",
  text: "t",
  richText: { text: "t", spans, emojis: [] },
  ...extra,
});

describe("comment filters", () => {
  const options = [
    { title: "Top", token: "t", selected: true },
    { title: "Newest", token: "n", selected: false },
  ];

  it("maps chips onto YouTube's two orders by position", () => {
    expect(commentSortFor(options, "top")?.token).toBe("t");
    expect(commentSortFor(options, "newest")?.token).toBe("n");
    expect(commentSortFor(options, "oldest")?.token).toBe("n");
    expect(timedCommentOrders(options).map((o) => o.token)).toEqual(["n", "t"]);
  });

  it("reads the first timestamp by place in the text", () => {
    expect(firstTimestampSeconds(comment("a", {}, [stamp(9, 50), stamp(2, 10)]))).toBe(10);
    expect(firstTimestampSeconds(comment("a"))).toBeNull();
  });

  it("orders timed comments latest first, most liked first at the same spot, without past-the-end times", () => {
    const list = [
      comment("early", { likeCount: 9 }, [stamp(0, 10)]),
      comment("late", {}, [stamp(0, 90)]),
      comment("late-liked", { likeCount: 5, isPinned: true }, [stamp(0, 90)]),
      comment("past", {}, [stamp(0, 500)]),
      comment("none"),
    ];
    expect(timedCommentsInOrder(list, 100).map((c) => c.id)).toEqual(["late-liked", "late", "early"]);
    expect(timedCommentsInOrder(list, 0)[0]?.id).toBe("past");
  });

  it("finds the latest timestamp already passed", () => {
    const seconds = [90, 50, 10];
    expect(timedAnchorIndex(seconds, 5)).toBe(-1);
    expect(timedAnchorIndex(seconds, 10.9)).toBe(2);
    expect(timedAnchorIndex(seconds, 49.9)).toBe(2);
    expect(timedAnchorIndex(seconds, 50)).toBe(1);
    expect(timedAnchorIndex(seconds, 500)).toBe(0);
    expect(timedAnchorIndex([], 5)).toBe(-1);
  });

  it("puts the oldest first and keeps pinned on top", () => {
    const list = [
      comment("new", { publishedText: "2 hours ago" }),
      comment("pin", { publishedText: "1 minute ago", isPinned: true }),
      comment("old", { publishedText: "3 years ago (edited)" }),
      comment("mid", { publishedText: "4 weeks ago" }),
    ];
    expect(oldestCommentsFirst(list).map((c) => c.id)).toEqual(["pin", "old", "mid", "new"]);
  });
});
