import { describe, expect, it } from "vitest";
import { MAX_SEARCH_CHARS, clipSearchQuery, searchLength } from "./searchQuery";

describe("clipSearchQuery", () => {
  it("keeps a long question whole up to the limit", () => {
    const question = "a".repeat(MAX_SEARCH_CHARS);
    expect(clipSearchQuery(`  ${question}  `)).toBe(question);
  });

  it("cuts text past the limit instead of refusing it", () => {
    expect(clipSearchQuery("b".repeat(MAX_SEARCH_CHARS + 40))).toHaveLength(MAX_SEARCH_CHARS);
  });

  it("cuts between characters, never inside an emoji", () => {
    const text = `${"c".repeat(MAX_SEARCH_CHARS - 1)}😀😀`;
    const clipped = clipSearchQuery(text);
    expect(searchLength(clipped)).toBe(MAX_SEARCH_CHARS);
    expect(clipped.endsWith("😀")).toBe(true);
  });

  it("drops the space a cut leaves at the end", () => {
    expect(clipSearchQuery(`${"d".repeat(MAX_SEARCH_CHARS - 1)} e`)).toBe("d".repeat(MAX_SEARCH_CHARS - 1));
  });
});
