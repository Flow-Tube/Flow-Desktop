import {
  DEFAULT_THEME,
  expandPalette,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeSeed,
} from "./themes";

/** The theme id that means "use the user's custom.css". */
export const THEME_FILE_ID = "user-file";

export type ThemeFileScheme = "light" | "dark";

/** The `--flow-*` names a theme file sets, by the colour each one feeds. */
export const THEME_FILE_TOKENS: Record<keyof ThemeColors, string> = {
  primary: "--flow-primary",
  onPrimary: "--flow-on-primary",
  secondary: "--flow-secondary",
  background: "--flow-background",
  surface: "--flow-surface",
  surfaceContainerLow: "--flow-surface-container-low",
  surfaceContainer: "--flow-surface-container",
  surfaceContainerHigh: "--flow-surface-container-high",
  surfaceContainerHighest: "--flow-surface-container-highest",
  outline: "--flow-outline",
  onSurface: "--flow-on-surface",
  onSurfaceVariant: "--flow-on-surface-variant",
  error: "--flow-error",
};

const SCHEME_TOKEN = "--flow-scheme";

const SEED_KEYS: (keyof ThemeSeed)[] = [
  "primary", "onPrimary", "secondary", "background", "surface",
  "onSurface", "onSurfaceVariant", "outline", "error",
];

const CONTAINER_KEYS = [
  "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
] as const;

export interface ThemeFileTheme {
  theme: ThemeDefinition;
  scheme: ThemeFileScheme;
  /** `--flow-*` names whose value is not a colour, so Flow's default was used. */
  ignoredTokens: string[];
}

/** Turns a resolved `#rrggbb` into its relative luminance, 0 for black to 1 for white. */
function luminance(hex: string): number | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!match) return null;
  const [r, g, b] = match.slice(1).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The scheme the file asks for, or the one its background reads as. */
export function themeFileScheme(declared: string, background: string | null): ThemeFileScheme {
  const value = declared.trim().toLowerCase();
  if (value === "light" || value === "dark") return value;
  const level = background ? luminance(background) : null;
  return level !== null && level > 0.4 ? "light" : "dark";
}

function seedOf(colors: ThemeColors): ThemeSeed {
  return Object.fromEntries(SEED_KEYS.map((key) => [key, colors[key]])) as ThemeSeed;
}

/**
 * Builds a theme from the values a file declared. `readToken` returns a token's
 * raw value ("" when unset); `resolveColor` returns it as hex, or null when it is
 * not a colour. Unset or invalid colours keep Flow Default's, and the always-dark
 * surfaces of a light file keep Flow's dark greys with the file's accent.
 */
export function buildThemeFileTheme(
  readToken: (name: string) => string,
  resolveColor: (value: string) => string | null,
): ThemeFileTheme {
  const ignoredTokens: string[] = [];
  const resolved: Partial<ThemeColors> = {};
  for (const [key, name] of Object.entries(THEME_FILE_TOKENS) as [keyof ThemeColors, string][]) {
    const raw = readToken(name).trim();
    if (!raw) continue;
    const color = resolveColor(raw);
    if (color) resolved[key] = color;
    else ignoredTokens.push(name);
  }

  const scheme = themeFileScheme(readToken(SCHEME_TOKEN), resolved.background ?? null);
  const other: ThemeFileScheme = scheme === "light" ? "dark" : "light";
  const fileSeed: ThemeSeed = { ...seedOf(DEFAULT_THEME.variants[scheme]) };
  for (const key of SEED_KEYS) {
    if (resolved[key]) fileSeed[key] = resolved[key];
  }
  const fileColors = expandPalette(fileSeed, scheme);
  for (const key of CONTAINER_KEYS) {
    if (resolved[key]) fileColors[key] = resolved[key];
  }

  const accent = { primary: fileSeed.primary, onPrimary: fileSeed.onPrimary, error: fileSeed.error };
  const otherSeed: ThemeSeed = { ...seedOf(DEFAULT_THEME.variants[other]), ...accent };
  const darkSeed = scheme === "dark" ? fileSeed : otherSeed;

  return {
    theme: {
      id: THEME_FILE_ID,
      name: "custom.css",
      descriptionKey: "theme_description_default",
      variants: {
        [scheme]: fileColors,
        [other]: expandPalette(otherSeed, other),
        amoled: expandPalette(darkSeed, "amoled"),
      } as ThemeDefinition["variants"],
    },
    scheme,
    ignoredTokens,
  };
}

/** One `url(...)` argument, or a quoted `image-set()` entry, with any quotes removed. */
const URL_ARGUMENT = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const QUOTED = /(['"])(.*?)\1/g;

function isLocalReference(target: string): boolean {
  const value = target.trim().toLowerCase();
  return value.startsWith("data:") || value.startsWith("#");
}

/** Whether a declared value would make the webview fetch something from outside Flow. */
export function loadsRemoteResource(value: string): boolean {
  for (const match of value.matchAll(URL_ARGUMENT)) {
    if (!isLocalReference(match[2] ?? "")) return true;
  }
  if (/image-set\(/i.test(value)) {
    for (const match of value.replace(URL_ARGUMENT, "").matchAll(QUOTED)) {
      if (!isLocalReference(match[2] ?? "")) return true;
    }
  }
  return false;
}

const IMPORT_RULE = 3;
const FONT_FACE_RULE = 5;

interface RuleContainer {
  cssRules: CSSRuleList;
  deleteRule(index: number): void;
}

/**
 * Removes everything in a parsed theme file that would load from the network:
 * `@import`, `@font-face`, and declarations with a remote `url()` or
 * `image-set()`, custom properties included, since `var()` could carry them
 * anywhere. Walks the parsed rules, so escapes in the text cannot hide a URL.
 * Returns how many it removed.
 */
export function stripRemoteResources(container: RuleContainer): number {
  let removed = 0;
  for (let index = container.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = container.cssRules[index]!;
    if (rule.type === IMPORT_RULE || rule.type === FONT_FACE_RULE) {
      container.deleteRule(index);
      removed += 1;
      continue;
    }
    const style = (rule as CSSStyleRule).style as CSSStyleDeclaration | undefined;
    if (style) {
      for (let property = style.length - 1; property >= 0; property -= 1) {
        const name = style.item(property);
        if (loadsRemoteResource(style.getPropertyValue(name))) {
          style.removeProperty(name);
          removed += 1;
        }
      }
    }
    const nested = rule as unknown as Partial<RuleContainer>;
    if (nested.cssRules && typeof nested.deleteRule === "function") {
      removed += stripRemoteResources(nested as RuleContainer);
    }
  }
  return removed;
}
