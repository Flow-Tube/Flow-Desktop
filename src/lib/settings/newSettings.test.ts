import { describe, expect, it } from "vitest";

import { newSettings, recordKnownSettings } from "./newSettings";
import type { SettingEntry } from "./settingsIndex";

const entry = (title: string): SettingEntry => ({ title, category: "player" }) as unknown as SettingEntry;

describe("new settings", () => {
  it("treats everything as known on the first run", () => {
    const seen = recordKnownSettings(null, ["a", "b"], 100);
    expect(newSettings(seen, [entry("a"), entry("b")], 100, 14).titles.size).toBe(0);
  });

  it("marks a setting from a later build, for the chosen number of days", () => {
    const seen = recordKnownSettings({ a: 0 }, ["a", "b"], 100);
    expect(seen).toEqual({ a: 0, b: 100 });

    const fresh = newSettings(seen, [entry("a"), entry("b")], 113, 14);
    expect([...fresh.titles]).toEqual(["b"]);
    expect([...fresh.categories]).toEqual(["player"]);
    expect(newSettings(seen, [entry("b")], 114, 14).titles.size).toBe(0);
  });

  it("forgets a setting that left the index", () => {
    expect(recordKnownSettings({ gone: 5, a: 0 }, ["a"], 100)).toEqual({ a: 0 });
  });
});
