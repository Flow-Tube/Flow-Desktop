import { describe, expect, it, vi } from "vitest";
import { AI_LIST_MATCHER_NONE, AiHandleIndex, createAiListMatcher, toAiLists, type AiListRules } from "./matcher";

const LISTED_ID = "UCbbbbbbbbbbbbbbbbbbbbbb";
const OTHER_ID = "UCoooooooooooooooooooooo";

const lists = toAiLists({ handles: ["drew", "slopmaker"], ids: [LISTED_ID] }, { handles: ["maybeslop"], ids: [] });

function rules(overrides: Partial<AiListRules> = {}): AiListRules {
  return { blockEnabled: true, warnEnabled: true, exemptIds: new Set(), exemptHandles: new Set(), ...overrides };
}

describe("createAiListMatcher", () => {
  it("matches a listed handle only as a whole handle", () => {
    const matcher = createAiListMatcher(lists, rules(), null);
    expect(matcher.verdict(OTHER_ID, "/@Drew")).toBe("block");
    expect(matcher.verdict(OTHER_ID, "/@drewbinsky")).toBe("none");
  });

  it("matches a listed channel id without a handle, with or without the channel: prefix", () => {
    const matcher = createAiListMatcher(lists, rules(), null);
    expect(matcher.verdict(LISTED_ID)).toBe("block");
    expect(matcher.verdict(`channel:${LISTED_ID}`)).toBe("block");
  });

  it("keeps the block and warn lists apart", () => {
    const matcher = createAiListMatcher(lists, rules(), null);
    expect(matcher.verdict(OTHER_ID, "@SlopMaker")).toBe("block");
    expect(matcher.verdict(OTHER_ID, "@MaybeSlop")).toBe("warn");
  });

  it("still labels a block-list channel with hiding off", () => {
    expect(createAiListMatcher(lists, rules({ blockEnabled: false }), null).verdict(OTHER_ID, "@SlopMaker")).toBe("warn");
    expect(createAiListMatcher(lists, rules({ warnEnabled: false }), null).verdict(OTHER_ID, "@MaybeSlop")).toBe("none");
  });

  it("never flags a subscribed or allowed channel", () => {
    expect(createAiListMatcher(lists, rules({ exemptIds: new Set([OTHER_ID]) }), null).verdict(OTHER_ID, "@SlopMaker")).toBe(
      "none",
    );
    expect(
      createAiListMatcher(lists, rules({ exemptHandles: new Set(["slopmaker"]) }), null).verdict(OTHER_ID, "@SlopMaker"),
    ).toBe("none");
  });

  it("is off with both switches off or no list", () => {
    expect(createAiListMatcher(lists, rules({ blockEnabled: false, warnEnabled: false }), null)).toBe(AI_LIST_MATCHER_NONE);
    expect(createAiListMatcher(null, rules(), null)).toBe(AI_LIST_MATCHER_NONE);
    expect(AI_LIST_MATCHER_NONE.verdict(LISTED_ID)).toBe("none");
  });

  it("matches a channel id seen once with its handle later without it, and reports the pair", () => {
    const onLearn = vi.fn();
    const matcher = createAiListMatcher(lists, rules(), new AiHandleIndex([], onLearn));
    const learned = "UCllllllllllllllllllllll";

    expect(matcher.verdict(learned)).toBe("none");
    matcher.verdict(learned, "/@SlopMaker");
    expect(matcher.verdict(learned)).toBe("block");
    expect(onLearn).toHaveBeenCalledWith(learned, "slopmaker");

    const page = "UCcccccccccccccccccccccc";
    matcher.learn(page, "@MaybeSlop");
    expect(matcher.verdict(page)).toBe("warn");
  });
});

describe("AiHandleIndex", () => {
  it("forgets the least recently used channel first", () => {
    const index = new AiHandleIndex([], () => {}, 2);
    index.learn("a", "one");
    index.learn("b", "two");
    index.handleFor("a");
    index.learn("c", "three");

    expect(index.handleFor("a")).toBe("one");
    expect(index.handleFor("b")).toBeUndefined();
    expect(index.handleFor("c")).toBe("three");
  });

  it("reports only new or changed pairs", () => {
    const onLearn = vi.fn();
    const index = new AiHandleIndex([["a", "one"]], onLearn);
    index.learn("a", "one");
    index.learn("a", "two");
    expect(onLearn).toHaveBeenCalledTimes(1);
  });
});
