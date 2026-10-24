import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_THEMES, createCustomTheme, parseCustomThemes } from "./themes";
import { customThemesFileName, customThemesJson, mergeImportedThemes } from "./themeTransfer";

const theme = (id: string, name = id) => createCustomTheme(id, name);

function sequentialIds() {
  let next = 0;
  return () => `custom-fresh-${++next}`;
}

describe("custom theme transfer", () => {
  it("exports one theme as an object and several as a list, both of which import", () => {
    const one = theme("custom-a", "Night Shift");
    const json = customThemesJson([one]);
    expect(JSON.parse(json)).toEqual(one);
    expect(parseCustomThemes(json)).toEqual([one]);

    const many = customThemesJson([one, theme("custom-b")]);
    expect(Array.isArray(JSON.parse(many))).toBe(true);
    expect(parseCustomThemes(many)).toHaveLength(2);
  });

  it("names the file after a single theme", () => {
    expect(customThemesFileName([theme("custom-a", "Night Shift!")])).toBe("flow_theme_night_shift.json");
    expect(customThemesFileName([theme("custom-a", "!!!")])).toBe("flow_theme_custom.json");
    expect(customThemesFileName([theme("custom-a"), theme("custom-b")])).toBe("flow_themes.json");
  });

  it("gives a clashing id a fresh one instead of overwriting", () => {
    const existing = [theme("custom-a", "Mine")];
    const result = mergeImportedThemes(existing, customThemesJson([theme("custom-a", "Theirs"), theme("custom-a", "Again")]), sequentialIds());

    expect(result.added).toBe(2);
    expect(result.themes.map((t) => [t.id, t.name])).toEqual([
      ["custom-a", "Mine"],
      ["custom-fresh-1", "Theirs"],
      ["custom-fresh-2", "Again"],
    ]);
  });

  it("drops invalid entries and keeps the valid ones", () => {
    const serialized = JSON.stringify([
      theme("custom-ok"),
      { id: "not-custom", name: "Bad", custom: true, variants: theme("x").variants },
      { id: "custom-empty", name: "  ", custom: true, variants: theme("x").variants },
      { id: "custom-broken", name: "Broken", custom: true, variants: {} },
    ]);
    const result = mergeImportedThemes([], serialized);
    expect(result.themes.map((t) => t.id)).toEqual(["custom-ok"]);
    expect(result.overLimit).toBe(0);
  });

  it("returns nothing for a file that is not a theme", () => {
    expect(mergeImportedThemes([], "not json").added).toBe(0);
    expect(mergeImportedThemes([], "{\"bands\":[]}").added).toBe(0);
    expect(mergeImportedThemes([], "null").added).toBe(0);
  });

  it("stops at the custom theme limit and counts what was left out", () => {
    const existing = Array.from({ length: MAX_CUSTOM_THEMES - 2 }, (_, i) => theme(`custom-${i}`));
    const incoming = Array.from({ length: 30 }, (_, i) => theme(`custom-new-${i}`));
    const result = mergeImportedThemes(existing, customThemesJson(incoming));

    expect(result.themes).toHaveLength(MAX_CUSTOM_THEMES);
    expect(result.added).toBe(2);
    expect(result.overLimit).toBe(28);
  });
});
