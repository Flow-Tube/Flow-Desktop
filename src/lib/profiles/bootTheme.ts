import { profileStorage } from "../storage/profileStorage";
import { DEFAULT_THEME, themeCssVariables, type ThemeColors, type ThemeVariant } from "../themes";

/** Read before the app loads by public/boot-theme.js. */
export const BOOT_THEME_KEY = "flow_boot_theme";

interface BootTheme {
  themeId: string;
  variant: ThemeVariant;
  variables: Record<string, string>;
}

function snapshot(themeId: string, colors: ThemeColors, variant: ThemeVariant): string {
  return JSON.stringify({ themeId, variant, variables: themeCssVariables(colors, variant) } satisfies BootTheme);
}

/** Remembers the theme this profile shows, for its next first paint. */
export function saveBootTheme(themeId: string, colors: ThemeColors, variant: ThemeVariant): void {
  try {
    profileStorage.setItem(BOOT_THEME_KEY, snapshot(themeId, colors, variant));
  } catch {
    // Storage full or blocked: the next start just paints the stylesheet defaults first.
  }
}

/** A new profile that starts fresh opens in the default theme. */
export function defaultBootTheme(): string {
  return snapshot(DEFAULT_THEME.id, DEFAULT_THEME.variants.dark, "dark");
}
