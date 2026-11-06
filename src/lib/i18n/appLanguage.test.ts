// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "flow_app_language";

async function start(tag: string | null) {
  vi.resetModules();
  window.localStorage.clear();
  if (tag) window.localStorage.setItem(KEY, tag);
  const i18n = await import("./index");
  await i18n.initAppLanguage();
  return i18n;
}

describe("app language", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("dir");
    document.documentElement.removeAttribute("lang");
  });

  it("stays in English with nothing chosen", async () => {
    const { APP_LOCALE, getString } = await start(null);
    expect(APP_LOCALE).toBe("en");
    expect(getString("settings_app_language")).toBe("App language");
    expect(document.documentElement.dir).toBe("");
  });

  it("ignores a language it has no file for", async () => {
    const { APP_LOCALE } = await start("xx");
    expect(APP_LOCALE).toBe("en");
  });

  it("uses the chosen language and leaves untranslated text in English", async () => {
    const { APP_LOCALE, getString } = await start("de");
    expect(APP_LOCALE).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.dir).toBe("ltr");
    expect(getString("settings_app_language")).toBe("App language");
    expect(getString("share")).not.toBe("Share");
  });

  it("sets right to left for the languages that read that way", async () => {
    await start("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("offers every language by its own name, with English first", async () => {
    const { appLanguageOptions } = await import("./appLanguageOptions");
    const options = appLanguageOptions();
    expect(options[0]).toEqual({ value: "", label: "English" });
    expect(options.length).toBe(34);
    expect(options.find((option) => option.value === "de")?.label).toBe("Deutsch");
  });
});
