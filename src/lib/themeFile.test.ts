import { afterEach, describe, expect, it } from "vitest";
import {
  THEME_FILE_ID,
  buildThemeFileTheme,
  loadsRemoteResource,
  stripRemoteResources,
  themeFileScheme,
} from "./themeFile";
import { DEFAULT_THEME } from "./themes";

const tokens = (values: Record<string, string>) => (name: string) => values[name] ?? "";
// Stands in for the browser: hex passes through, anything else is not a colour.
const hexOnly = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);

describe("themeFileScheme", () => {
  it("follows --flow-scheme when it names one", () => {
    expect(themeFileScheme(" Light ", "#000000")).toBe("light");
    expect(themeFileScheme("dark", "#ffffff")).toBe("dark");
  });

  it("reads the background's brightness otherwise", () => {
    expect(themeFileScheme("", "#fafafa")).toBe("light");
    expect(themeFileScheme("sepia", "#1e1e2e")).toBe("dark");
    expect(themeFileScheme("", null)).toBe("dark");
  });
});

describe("buildThemeFileTheme", () => {
  it("falls back to Flow Default when the file sets nothing", () => {
    const built = buildThemeFileTheme(tokens({}), hexOnly);
    expect(built.scheme).toBe("dark");
    expect(built.ignoredTokens).toEqual([]);
    expect(built.theme.id).toBe(THEME_FILE_ID);
    expect(built.theme.variants.dark.primary).toBe(DEFAULT_THEME.variants.dark.primary);
    expect(built.theme.variants.dark.background).toBe(DEFAULT_THEME.variants.dark.background);
  });

  it("uses the file's colours and mixes the container shades from them", () => {
    const built = buildThemeFileTheme(tokens({
      "--flow-primary": "#cba6f7",
      "--flow-background": "#11111b",
      "--flow-surface": "#1e1e2e",
      "--flow-on-surface": "#cdd6f4",
    }), hexOnly);
    const dark = built.theme.variants.dark;
    expect(dark.primary).toBe("#cba6f7");
    expect(dark.background).toBe("#11111b");
    expect(dark.surfaceContainer).toBe("#1e1e2e");
    expect(dark.surfaceContainerHigh).toContain("#cdd6f4");
  });

  it("keeps container shades the file sets itself", () => {
    const built = buildThemeFileTheme(tokens({ "--flow-surface-container-high": "#242424" }), hexOnly);
    expect(built.theme.variants.dark.surfaceContainerHigh).toBe("#242424");
  });

  it("names values that are not colours and keeps the default for them", () => {
    const built = buildThemeFileTheme(tokens({ "--flow-primary": "reddish", "--flow-error": "#ef5350" }), hexOnly);
    expect(built.ignoredTokens).toEqual(["--flow-primary"]);
    expect(built.theme.variants.dark.primary).toBe(DEFAULT_THEME.variants.dark.primary);
  });

  it("gives a light file Flow's dark greys with its accent for the always-dark surfaces", () => {
    const built = buildThemeFileTheme(tokens({
      "--flow-background": "#ffffff",
      "--flow-primary": "#1e66f5",
    }), hexOnly);
    expect(built.scheme).toBe("light");
    expect(built.theme.variants.light.background).toBe("#ffffff");
    expect(built.theme.variants.dark.background).toBe(DEFAULT_THEME.variants.dark.background);
    expect(built.theme.variants.dark.primary).toBe("#1e66f5");
    expect(built.theme.variants.amoled.background).toBe("#000000");
  });
});

describe("loadsRemoteResource", () => {
  it("flags remote urls in any spelling", () => {
    expect(loadsRemoteResource('url("https://tracker.example/p.png")')).toBe(true);
    expect(loadsRemoteResource("url(//cdn.example/x.png) no-repeat")).toBe(true);
    expect(loadsRemoteResource("URL( 'http://a.b/c' )")).toBe(true);
    expect(loadsRemoteResource('image-set("https://a.b/1x.png" 1x)')).toBe(true);
  });

  it("allows inline data and local references", () => {
    expect(loadsRemoteResource("url(data:image/png;base64,AAAA)")).toBe(false);
    expect(loadsRemoteResource('url("#grain")')).toBe(false);
    expect(loadsRemoteResource('image-set(url("data:image/png;base64,AA") 1x)')).toBe(false);
    expect(loadsRemoteResource("#ff0000")).toBe(false);
  });
});

describe("stripRemoteResources", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  function sheetOf(css: string) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    return style.sheet!;
  }

  it("drops remote declarations, font faces and imports, and keeps the rest", () => {
    const sheet = sheetOf(`
      @import url("https://evil.example/x.css");
      @font-face { font-family: X; src: url("https://fonts.example/x.woff2"); }
      :root { --flow-primary: #ff0000; --art: url("https://tracker.example/a.png"); }
      body { background: url("https://tracker.example/b.png"); color: red; }
      @media (min-width: 10px) { .x { background-image: url(https://tracker.example/c.png); } }
      .y { background-image: url("data:image/png;base64,AAAA"); }
    `);
    const removed = stripRemoteResources(sheet);
    const text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    expect(text).not.toContain("tracker.example");
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain("fonts.example");
    expect(text).toContain("--flow-primary");
    expect(text).toContain("color: red");
    expect(text).toContain("data:image/png");
    expect(removed).toBeGreaterThanOrEqual(5);
  });
});
