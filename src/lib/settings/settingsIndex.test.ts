import { describe, expect, it } from "vitest";

import { SETTINGS_INDEX } from "./settingsIndex";

const sources = import.meta.glob("../../components/settings/**/*.tsx", { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

describe("SETTINGS_INDEX", () => {
  it("has every row the settings tabs show", () => {
    const indexed = new Set<string>(SETTINGS_INDEX.map((entry) => entry.title));
    const missing: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/<SettingItem\b[^>]*?title=\{getString\(['"]([a-z0-9_]+)['"]\)\}/gs)) {
        if (!indexed.has(match[1]!)) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
