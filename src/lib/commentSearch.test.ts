import { describe, expect, it } from "vitest";
import { commentMatches, foundRanges, parseCommentQuery, threadMatches } from "./commentSearch";
import type { Comment } from "../types/video";

const comment = (text: string, author = "@someone"): Comment => ({ id: text, author, text });
const found = (text: string, query: string) =>
  foundRanges(text, parseCommentQuery(query)).map(({ start, end }) => text.slice(start, end));

describe("parseCommentQuery", () => {
  it("splits words, keeps a quoted phrase whole and drops repeats", () => {
    expect(parseCommentQuery('  Sung  "solo   leveling" sung ')).toEqual(["sung", "solo leveling"]);
    expect(parseCommentQuery('"" ')).toEqual([]);
  });
});

describe("commentMatches", () => {
  it("needs every word, in the text or the author's name", () => {
    expect(commentMatches(comment("The MC is called Jinwoo"), parseCommentQuery("jinwoo mc"))).toBe(true);
    expect(commentMatches(comment("The MC is called Jinwoo"), parseCommentQuery("jinwoo manhwa"))).toBe(false);
    expect(commentMatches(comment("chapter 110", "@ReadsManhwa"), parseCommentQuery("readsmanhwa 110"))).toBe(true);
  });

  it("ignores case and accents, and reads the Turkish dotted and dotless i as i", () => {
    expect(commentMatches(comment("Café RÉSUMÉ"), parseCommentQuery("cafe resume"))).toBe(true);
    expect(commentMatches(comment("İstanbul ve ılık"), parseCommentQuery("istanbul ilik"))).toBe(true);
  });

  it("keeps Japanese voiced marks apart", () => {
    expect(commentMatches(comment("がんばって"), parseCommentQuery("がんば"))).toBe(true);
    expect(commentMatches(comment("がんばって"), parseCommentQuery("かん"))).toBe(false);
  });

  it("matches a phrase only as written", () => {
    expect(commentMatches(comment("solo leveling season 2"), parseCommentQuery('"solo leveling"'))).toBe(true);
    expect(commentMatches(comment("leveling solo"), parseCommentQuery('"solo leveling"'))).toBe(false);
  });
});

describe("threadMatches", () => {
  it("keeps a comment whose loaded reply matches", () => {
    const parent = comment("what's the name?");
    expect(threadMatches(parent, [comment("Omniscient Reader")], parseCommentQuery("omniscient"))).toBe(true);
    expect(threadMatches(parent, undefined, parseCommentQuery("omniscient"))).toBe(false);
  });
});

describe("foundRanges", () => {
  it("finds every place in the original text, accents and case kept", () => {
    expect(found("Café and CAFE", "cafe")).toEqual(["Café", "CAFE"]);
  });

  it("joins finds that overlap", () => {
    expect(found("solo leveling", '"solo lev" leveling')).toEqual(["solo leveling"]);
  });

  it("keeps emoji and other long characters whole", () => {
    expect(found("ok 👍 Café 👍", "café")).toEqual(["Café"]);
  });

  it("finds nothing without words", () => {
    expect(foundRanges("anything", [])).toEqual([]);
  });
});
