import { describe, expect, it } from "vitest";
import { audioLanguageOptions } from "./audioLanguages";

describe("audio language options", () => {
  it("names every language in the UI language, sorted by name", () => {
    const options = audioLanguageOptions("en");
    const label = (code: string) => options.find((option) => option.value === code)?.label;

    expect(label("de")).toBe("German");
    expect(label("ja")).toBe("Japanese");
    expect(label("zh-Hant")).toBe("Traditional Chinese");
    expect(options.every((option) => option.label !== option.value)).toBe(true);
    const labels = options.map((option) => option.label);
    expect(labels).toEqual([...labels].sort((a, b) => new Intl.Collator("en").compare(a, b)));
  });

  it("follows another UI language", () => {
    expect(audioLanguageOptions("fr").find((option) => option.value === "de")?.label).toBe("allemand");
  });
});
