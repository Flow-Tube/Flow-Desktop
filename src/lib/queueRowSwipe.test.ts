import { describe, expect, it } from "vitest";

import {
  inCommitZone,
  inTension,
  leavesList,
  parseQueueSwipeAction,
  swipeActionFor,
  tensionOffset,
} from "./queueRowSwipe";

describe("queue row swipe", () => {
  it("holds the first 60 px of travel to 20 px", () => {
    expect(tensionOffset(30)).toBe(10);
    expect(tensionOffset(-60)).toBe(-20);
    expect(inTension(59)).toBe(true);
    expect(inTension(-60)).toBe(false);
  });

  it("commits past 40 % of the row", () => {
    expect(inCommitZone(161, 400)).toBe(true);
    expect(inCommitZone(-160, 400)).toBe(false);
    expect(inCommitZone(500, 0)).toBe(false);
  });

  it("takes the left action for a swipe to the left", () => {
    expect(swipeActionFor(-100, "PLAY_NEXT", "REMOVE")).toBe("PLAY_NEXT");
    expect(swipeActionFor(100, "PLAY_NEXT", "REMOVE")).toBe("REMOVE");
  });

  it("only flies a removed row off", () => {
    expect(leavesList("REMOVE")).toBe(true);
    expect(leavesList("MOVE_TO_END")).toBe(false);
  });

  it("falls back for an unknown stored action", () => {
    expect(parseQueueSwipeAction("MOVE_TO_END", "REMOVE")).toBe("MOVE_TO_END");
    expect(parseQueueSwipeAction("SHUFFLE", "REMOVE")).toBe("REMOVE");
  });
});
