import { describe, expect, it } from "vitest";

import { parseHiddenLibrarySections, toggledHiddenSections } from "./librarySections";

describe("hidden Library sections", () => {
  it("reads what was stored and survives junk", () => {
    expect([...parseHiddenLibrarySections('["HISTORY",3]')]).toEqual(["HISTORY"]);
    expect(parseHiddenLibrarySections("{").size).toBe(0);
    expect(parseHiddenLibrarySections('"HISTORY"').size).toBe(0);
  });

  it("adds and removes a section", () => {
    const hidden = parseHiddenLibrarySections(toggledHiddenSections(new Set(), "LIKES", true));
    expect(hidden.has("LIKES")).toBe(true);
    expect(parseHiddenLibrarySections(toggledHiddenSections(hidden, "LIKES", false)).size).toBe(0);
  });
});
