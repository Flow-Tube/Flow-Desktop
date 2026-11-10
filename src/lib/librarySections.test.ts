import { describe, expect, it } from "vitest";

import { parseHiddenLibrarySections, toggledHiddenSections, hiddenOnLibraryPage } from "./librarySections";

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

describe("hiddenOnLibraryPage", () => {
  it("hides Saved Shorts while Shorts are hidden, on top of the viewer's own choices", () => {
    const hidden = new Set(["LIKES"]);
    expect(hiddenOnLibraryPage(hidden, true)).toBe(hidden);
    expect([...hiddenOnLibraryPage(hidden, false)].sort()).toEqual(["LIKES", "SAVED_SHORTS"]);
  });

  it("hides Albums and Music downloads while Show Music is off", () => {
    const hidden = new Set(["LIKES"]);
    expect(hiddenOnLibraryPage(hidden, true, true)).toBe(hidden);
    expect([...hiddenOnLibraryPage(hidden, true, false)].sort()).toEqual(["ALBUMS", "LIKES", "MUSIC_DOWNLOADS"]);
  });
});
