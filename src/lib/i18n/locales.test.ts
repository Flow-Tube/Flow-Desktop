import { describe, expect, it } from "vitest";

import strings from "./strings.json";

const locales = import.meta.glob("./locales/*.json", { eager: true, import: "default" }) as Record<
  string,
  Record<string, string>
>;

const placeholders = (text: string) =>
  (text.match(/%(?:\d+\$)?[sd]/g) ?? []).map((token) => token.replace(/\d+\$/, "")).sort();

describe("translations", () => {
  const base = strings as Record<string, string>;

  it("covers the languages Flow for Android ships", () => {
    expect(Object.keys(locales).length).toBe(33);
  });

  it.each(Object.entries(locales))("%s only has known keys and keeps each string's placeholders", (_, table) => {
    for (const [key, text] of Object.entries(table)) {
      expect(base[key], key).toBeDefined();
      expect(text.trim(), key).not.toBe("");
      expect(placeholders(text), key).toEqual(placeholders(base[key]!));
    }
  });
});
