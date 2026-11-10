import { describe, expect, it } from "vitest";

import { SETTINGS_INDEX, type SettingEntry } from "./settingsIndex";
import { searchSettings } from "./settingsSearch";

const titles = (entries: SettingEntry[]) => entries.map((entry) => entry.title);

describe("searchSettings", () => {
  it("finds nothing for a blank query", () => {
    expect(searchSettings("  ", SETTINGS_INDEX)).toEqual([]);
  });

  it("needs every word to match", () => {
    expect(searchSettings("proxy zzzz", SETTINGS_INDEX)).toEqual([]);
  });

  it("ranks a title match first, and ignores case and accents", () => {
    expect(titles(searchSettings("PRÓXY", SETTINGS_INDEX))[0]).toBe("settings_enable_proxy");
  });

  it("finds a row by a keyword that isn't on it", () => {
    expect(titles(searchSettings("dubbed", SETTINGS_INDEX))).toContain("settings_audio_track_language");
  });

  it("finds rows by the page they're on", () => {
    expect(searchSettings("downloads", SETTINGS_INDEX).length).toBeGreaterThan(3);
  });
});
