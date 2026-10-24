import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  THEME_VARIANTS,
  createCustomTheme,
  parseCustomThemes,
  resolveTheme,
  themeCssVariables,
  scopeVariables,
} from "./themes";

describe("themes", () => {
  it("provides every built-in palette in all three variants", () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BUILTIN_THEMES.map((theme) => theme.id)).size).toBe(BUILTIN_THEMES.length);

    for (const theme of BUILTIN_THEMES) {
      for (const variant of THEME_VARIANTS) {
        expect(theme.variants[variant]).toBeDefined();
      }
      expect(theme.variants.amoled.background).toBe("#000000");
    }
  });

  it("round-trips valid custom themes and rejects malformed entries", () => {
    const custom = createCustomTheme("custom-test", "Test palette");
    const parsed = parseCustomThemes(JSON.stringify([
      custom,
      { id: "custom-broken", name: "Broken", custom: true, variants: {} },
    ]));

    expect(parsed).toEqual([custom]);
    expect(resolveTheme(custom.id, parsed)).toEqual(custom);
  });

  it("falls back to Flow Default for an unknown selection", () => {
    expect(resolveTheme("missing", []).id).toBe("default");
  });

  it("maps semantic and chrome variables for the active palette", () => {
    const colors = BUILTIN_THEMES.find((theme) => theme.id === "catppuccin")!.variants.light;
    const variables = themeCssVariables(colors, "light");

    expect(variables["--color-primary"]).toBe(colors.primary);
    expect(variables["--color-background-val"]).toBe(colors.background);
    expect(variables["--color-chrome-neutral-100"]).toBe(colors.onSurface);
    expect(variables["--color-chrome-neutral-500"]).toBe(colors.onSurfaceVariant);
    expect(variables["--color-chrome-neutral-600"]).toBe(colors.onSurfaceVariant);
    expect(variables["--color-chrome-neutral-800"]).toBe(colors.outline);
    expect(variables["--color-chrome-neutral-900"]).toBe(colors.surfaceContainer);
  });

  it("scopes one variant, including the tokens Tailwind derives from -val variables", () => {
    const theme = BUILTIN_THEMES[0]!;
    const dark = scopeVariables(theme, "dark");
    expect(dark["--color-chrome-neutral-100"]).toBe(theme.variants.dark.onSurface);
    expect(dark["--color-surface-container-high"]).toBe(theme.variants.dark.surfaceContainerHigh);
    expect(dark["--color-surface-container-high-val"]).toBe(theme.variants.dark.surfaceContainerHigh);
    expect(scopeVariables(theme, "amoled")["--color-background"]).toBe(theme.variants.amoled.background);
  });
});
