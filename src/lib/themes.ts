export const THEME_VARIANTS = ["light", "dark", "amoled"] as const;

export type ThemeVariant = (typeof THEME_VARIANTS)[number];

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  outline: string;
  onSurface: string;
  onSurfaceVariant: string;
  error: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  descriptionKey: ThemeDescriptionKey;
  variants: Record<ThemeVariant, ThemeColors>;
  custom?: boolean;
}

export interface CustomThemeDefinition extends Omit<ThemeDefinition, "descriptionKey" | "custom"> {
  descriptionKey?: never;
  custom: true;
}

export type ThemeDescriptionKey =
  | "theme_description_default"
  | "theme_description_monochrome"
  | "theme_description_catppuccin"
  | "theme_description_green_apple"
  | "theme_description_lavender"
  | "theme_description_nord"
  | "theme_description_tako"
  | "theme_description_yin_yang"
  | "theme_description_strawberry_daiquiri"
  | "theme_description_kanagawa"
  | "theme_description_tokyo_night"
  | "theme_description_rose_pine"
  | "theme_description_everforest"
  | "theme_description_gruvbox"
  | "theme_description_dracula"
  | "theme_description_solarized"
  | "theme_description_tide"
  | "theme_description_sage"
  | "theme_description_caffeine"
  | "theme_description_claude"
  | "theme_description_deep_ocean"
  | "theme_description_gunmetal"
  | "theme_description_cosmic_void"
  | "theme_description_cyberpunk"
  | "theme_description_royal_gold"
  | "theme_description_cream_paper";

interface PaletteSeed {
  id: string;
  name: string;
  descriptionKey: ThemeDescriptionKey;
  light: Pick<ThemeColors, "primary" | "onPrimary" | "secondary" | "background" | "surface" | "onSurface" | "onSurfaceVariant" | "outline" | "error">;
  dark: Pick<ThemeColors, "primary" | "onPrimary" | "secondary" | "background" | "surface" | "onSurface" | "onSurfaceVariant" | "outline" | "error">;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function expandPalette(
  base: PaletteSeed["light"],
  variant: ThemeVariant,
): ThemeColors {
  const dark = variant !== "light";
  const background = variant === "amoled" ? "#000000" : base.background;
  const surface = variant === "amoled" ? "#080808" : base.surface;

  return {
    ...base,
    background,
    surface,
    surfaceContainerLow: variant === "amoled" ? "#050505" : `color-mix(in srgb, ${surface} ${dark ? 72 : 58}%, ${background})`,
    surfaceContainer: variant === "amoled" ? "#0c0c0c" : surface,
    surfaceContainerHigh: variant === "amoled" ? "#141414" : `color-mix(in srgb, ${base.onSurface} ${dark ? 9 : 7}%, ${surface})`,
    surfaceContainerHighest: variant === "amoled" ? "#1c1c1c" : `color-mix(in srgb, ${base.onSurface} ${dark ? 14 : 11}%, ${surface})`,
  };
}

function createTheme(seed: PaletteSeed): ThemeDefinition {
  return {
    id: seed.id,
    name: seed.name,
    descriptionKey: seed.descriptionKey,
    variants: {
      light: expandPalette(seed.light, "light"),
      dark: expandPalette(seed.dark, "dark"),
      amoled: expandPalette(seed.dark, "amoled"),
    },
  };
}

const seeds: PaletteSeed[] = [
  {
    id: "default", name: "Flow Default", descriptionKey: "theme_description_default",
    light: { primary: "#ff0000", onPrimary: "#ffffff", secondary: "#606060", background: "#ffffff", surface: "#f3f3f3", onSurface: "#111111", onSurfaceVariant: "#5f5f5f", outline: "#d7d7d7", error: "#d32f2f" },
    dark: { primary: "#ff0000", onPrimary: "#ffffff", secondary: "#aaaaaa", background: "#0f0f0f", surface: "#1d1d1d", onSurface: "#f4f4f4", onSurfaceVariant: "#b8b8b8", outline: "#343434", error: "#ef5350" },
  },
  {
    id: "monochrome", name: "Monochrome", descriptionKey: "theme_description_monochrome",
    light: { primary: "#202020", onPrimary: "#ffffff", secondary: "#595959", background: "#ffffff", surface: "#f2f2f2", onSurface: "#111111", onSurfaceVariant: "#575757", outline: "#d2d2d2", error: "#a62b2b" },
    dark: { primary: "#eeeeee", onPrimary: "#111111", secondary: "#bcbcbc", background: "#111111", surface: "#1d1d1d", onSurface: "#f3f3f3", onSurfaceVariant: "#bcbcbc", outline: "#3a3a3a", error: "#e06c6c" },
  },
  {
    id: "catppuccin", name: "Catppuccin", descriptionKey: "theme_description_catppuccin",
    light: { primary: "#8839ef", onPrimary: "#ffffff", secondary: "#7287fd", background: "#eff1f5", surface: "#e6e9ef", onSurface: "#4c4f69", onSurfaceVariant: "#6c6f85", outline: "#bcc0cc", error: "#d20f39" },
    dark: { primary: "#cba6f7", onPrimary: "#1e1e2e", secondary: "#89b4fa", background: "#11111b", surface: "#1e1e2e", onSurface: "#cdd6f4", onSurfaceVariant: "#a6adc8", outline: "#45475a", error: "#f38ba8" },
  },
  {
    id: "green-apple", name: "Green Apple", descriptionKey: "theme_description_green_apple",
    light: { primary: "#3f7d20", onPrimary: "#ffffff", secondary: "#72a83b", background: "#fbfff7", surface: "#eef6e8", onSurface: "#17210f", onSurfaceVariant: "#53614a", outline: "#c7d7bb", error: "#ba1a1a" },
    dark: { primary: "#a5d66a", onPrimary: "#1d3700", secondary: "#89b75a", background: "#10150c", surface: "#1a2214", onSurface: "#e7f0df", onSurfaceVariant: "#bdcbb3", outline: "#3b4932", error: "#ffb4ab" },
  },
  {
    id: "lavender", name: "Lavender", descriptionKey: "theme_description_lavender",
    light: { primary: "#7357a4", onPrimary: "#ffffff", secondary: "#8d73b8", background: "#fdf9ff", surface: "#f3edfa", onSurface: "#211a29", onSurfaceVariant: "#62586c", outline: "#d0c4db", error: "#ba1a1a" },
    dark: { primary: "#d2b8ff", onPrimary: "#3e246c", secondary: "#bea4e6", background: "#151119", surface: "#211a28", onSurface: "#eee6f2", onSurfaceVariant: "#cabfd0", outline: "#4a4053", error: "#ffb4ab" },
  },
  {
    id: "nord", name: "Nord", descriptionKey: "theme_description_nord",
    light: { primary: "#5e81ac", onPrimary: "#ffffff", secondary: "#81a1c1", background: "#eceff4", surface: "#e5e9f0", onSurface: "#2e3440", onSurfaceVariant: "#4c566a", outline: "#c3cad5", error: "#bf616a" },
    dark: { primary: "#88c0d0", onPrimary: "#1f2933", secondary: "#81a1c1", background: "#242933", surface: "#2e3440", onSurface: "#eceff4", onSurfaceVariant: "#d8dee9", outline: "#4c566a", error: "#bf616a" },
  },
  {
    id: "tako", name: "Tako", descriptionKey: "theme_description_tako",
    light: { primary: "#6650a4", onPrimary: "#ffffff", secondary: "#7d5260", background: "#fff7ff", surface: "#f6eef8", onSurface: "#211f26", onSurfaceVariant: "#625b67", outline: "#cac2cf", error: "#ba1a1a" },
    dark: { primary: "#d0bcff", onPrimary: "#381e72", secondary: "#e8b9c7", background: "#17131c", surface: "#221d29", onSurface: "#e9e1eb", onSurfaceVariant: "#ccc3d0", outline: "#4b4450", error: "#ffb4ab" },
  },
  {
    id: "yin-yang", name: "Yin & Yang", descriptionKey: "theme_description_yin_yang",
    light: { primary: "#343434", onPrimary: "#ffffff", secondary: "#6e6e6e", background: "#fafafa", surface: "#ededed", onSurface: "#151515", onSurfaceVariant: "#5b5b5b", outline: "#cccccc", error: "#b3261e" },
    dark: { primary: "#fafafa", onPrimary: "#171717", secondary: "#c7c7c7", background: "#0b0b0b", surface: "#171717", onSurface: "#f5f5f5", onSurfaceVariant: "#bdbdbd", outline: "#383838", error: "#f2b8b5" },
  },
  {
    id: "strawberry-daiquiri", name: "Strawberry Daiquiri", descriptionKey: "theme_description_strawberry_daiquiri",
    light: { primary: "#b3264f", onPrimary: "#ffffff", secondary: "#9b405b", background: "#fff8f8", surface: "#fcebed", onSurface: "#28171b", onSurfaceVariant: "#6b555b", outline: "#dbc0c7", error: "#ba1a1a" },
    dark: { primary: "#ffb1c3", onPrimary: "#67002b", secondary: "#e8b8c4", background: "#1c1013", surface: "#291a1e", onSurface: "#f4dfe4", onSurfaceVariant: "#d6c0c6", outline: "#523b41", error: "#ffb4ab" },
  },
  {
    id: "kanagawa", name: "Kanagawa", descriptionKey: "theme_description_kanagawa",
    light: { primary: "#6f5c2f", onPrimary: "#ffffff", secondary: "#597b75", background: "#f2ecdc", surface: "#e7dfcf", onSurface: "#36322b", onSurfaceVariant: "#6f685b", outline: "#c5baa5", error: "#c34043" },
    dark: { primary: "#e6c384", onPrimary: "#282727", secondary: "#7e9cd8", background: "#1f1f28", surface: "#2a2a37", onSurface: "#dcd7ba", onSurfaceVariant: "#c8c093", outline: "#54546d", error: "#e46876" },
  },
  {
    id: "tokyo-night", name: "Tokyo Night", descriptionKey: "theme_description_tokyo_night",
    light: { primary: "#34548a", onPrimary: "#ffffff", secondary: "#5a4a78", background: "#d5d6db", surface: "#cbccd1", onSurface: "#343b58", onSurfaceVariant: "#596172", outline: "#a8abb5", error: "#8c4351" },
    dark: { primary: "#7aa2f7", onPrimary: "#10121b", secondary: "#bb9af7", background: "#16161e", surface: "#1f2335", onSurface: "#c0caf5", onSurfaceVariant: "#a9b1d6", outline: "#3b4261", error: "#f7768e" },
  },
  {
    id: "rose-pine", name: "Rosé Pine", descriptionKey: "theme_description_rose_pine",
    light: { primary: "#907aa9", onPrimary: "#ffffff", secondary: "#d7827e", background: "#faf4ed", surface: "#f2e9e1", onSurface: "#575279", onSurfaceVariant: "#797593", outline: "#cecacd", error: "#b4637a" },
    dark: { primary: "#c4a7e7", onPrimary: "#191724", secondary: "#ebbcba", background: "#191724", surface: "#26233a", onSurface: "#e0def4", onSurfaceVariant: "#908caa", outline: "#403d52", error: "#eb6f92" },
  },
  {
    id: "everforest", name: "Everforest", descriptionKey: "theme_description_everforest",
    light: { primary: "#8da101", onPrimary: "#ffffff", secondary: "#35a77c", background: "#fdf6e3", surface: "#f4f0d9", onSurface: "#5c6a72", onSurfaceVariant: "#829181", outline: "#d3cdb2", error: "#f85552" },
    dark: { primary: "#a7c080", onPrimary: "#1e2326", secondary: "#83c092", background: "#1e2326", surface: "#272e33", onSurface: "#d3c6aa", onSurfaceVariant: "#9da9a0", outline: "#414b50", error: "#e67e80" },
  },
  {
    id: "gruvbox", name: "Gruvbox", descriptionKey: "theme_description_gruvbox",
    light: { primary: "#b57614", onPrimary: "#ffffff", secondary: "#79740e", background: "#fbf1c7", surface: "#ebdbb2", onSurface: "#3c3836", onSurfaceVariant: "#665c54", outline: "#d5c4a1", error: "#cc241d" },
    dark: { primary: "#fabd2f", onPrimary: "#282828", secondary: "#b8bb26", background: "#1d2021", surface: "#282828", onSurface: "#ebdbb2", onSurfaceVariant: "#bdae93", outline: "#504945", error: "#fb4934" },
  },
  {
    id: "dracula", name: "Dracula", descriptionKey: "theme_description_dracula",
    light: { primary: "#6d4aa2", onPrimary: "#ffffff", secondary: "#a33c83", background: "#f8f7fb", surface: "#eceaf2", onSurface: "#282a36", onSurfaceVariant: "#626473", outline: "#cfccd8", error: "#c93654" },
    dark: { primary: "#bd93f9", onPrimary: "#282a36", secondary: "#ff79c6", background: "#21222c", surface: "#282a36", onSurface: "#f8f8f2", onSurfaceVariant: "#c5c8d4", outline: "#44475a", error: "#ff5555" },
  },
  {
    id: "solarized", name: "Solarized", descriptionKey: "theme_description_solarized",
    light: { primary: "#268bd2", onPrimary: "#ffffff", secondary: "#2aa198", background: "#fdf6e3", surface: "#eee8d5", onSurface: "#586e75", onSurfaceVariant: "#657b83", outline: "#d6cfb8", error: "#dc322f" },
    dark: { primary: "#2aa198", onPrimary: "#002b36", secondary: "#268bd2", background: "#002b36", surface: "#073642", onSurface: "#eee8d5", onSurfaceVariant: "#93a1a1", outline: "#335963", error: "#dc322f" },
  },
  {
    id: "tide", name: "Tide", descriptionKey: "theme_description_tide",
    light: { primary: "#247f83", onPrimary: "#ffffff", secondary: "#5c8f91", background: "#f4fbfb", surface: "#e5f1f1", onSurface: "#183638", onSurfaceVariant: "#587173", outline: "#bfd1d1", error: "#ba1a1a" },
    dark: { primary: "#78c6c5", onPrimary: "#093737", secondary: "#97b8b8", background: "#101a1c", surface: "#182529", onSurface: "#dce8e8", onSurfaceVariant: "#aabbbb", outline: "#34474b", error: "#ffb4ab" },
  },
  {
    id: "sage", name: "Sage", descriptionKey: "theme_description_sage",
    light: { primary: "#5d7456", onPrimary: "#ffffff", secondary: "#778870", background: "#f7faf4", surface: "#ebf0e7", onSurface: "#20281d", onSurfaceVariant: "#5d6858", outline: "#c5cec0", error: "#ba1a1a" },
    dark: { primary: "#b4cda9", onPrimary: "#21351d", secondary: "#aebfa7", background: "#121812", surface: "#1c251d", onSurface: "#e2e9df", onSurfaceVariant: "#bec8ba", outline: "#3b493a", error: "#ffb4ab" },
  },
  {
    id: "caffeine", name: "Caffeine", descriptionKey: "theme_description_caffeine",
    light: { primary: "#795548", onPrimary: "#ffffff", secondary: "#9a6f5d", background: "#fffaf6", surface: "#f3e9e1", onSurface: "#30231e", onSurfaceVariant: "#6d5a51", outline: "#d7c4b9", error: "#ba1a1a" },
    dark: { primary: "#e6c2aa", onPrimary: "#442a1e", secondary: "#c7a797", background: "#15110f", surface: "#221a17", onSurface: "#eee4df", onSurfaceVariant: "#cdbdb5", outline: "#493a34", error: "#ffb4ab" },
  },
  {
    id: "claude", name: "Claude", descriptionKey: "theme_description_claude",
    light: { primary: "#c15f3c", onPrimary: "#ffffff", secondary: "#7d685f", background: "#f7f4ef", surface: "#ece7df", onSurface: "#2f2926", onSurfaceVariant: "#6b605b", outline: "#d2c9c0", error: "#b3261e" },
    dark: { primary: "#e07a58", onPrimary: "#2b1510", secondary: "#b9a49b", background: "#1d1b19", surface: "#282522", onSurface: "#eee9e5", onSurfaceVariant: "#c8beb8", outline: "#4b4541", error: "#ffb4ab" },
  },
  {
    id: "deep-ocean", name: "Deep Ocean", descriptionKey: "theme_description_deep_ocean",
    light: { primary: "#00629b", onPrimary: "#ffffff", secondary: "#2e7fa6", background: "#f5faff", surface: "#e6f0f9", onSurface: "#0b2135", onSurfaceVariant: "#4a6072", outline: "#bfd0df", error: "#ba1a1a" },
    dark: { primary: "#4fb3e8", onPrimary: "#00253a", secondary: "#7fd1e0", background: "#0a1929", surface: "#132438", onSurface: "#e3f2fd", onSurfaceVariant: "#a9c1d6", outline: "#2a4058", error: "#ffb4ab" },
  },
  {
    id: "gunmetal", name: "Gunmetal", descriptionKey: "theme_description_gunmetal",
    light: { primary: "#455a64", onPrimary: "#ffffff", secondary: "#607d8b", background: "#f7f9fa", surface: "#eceff1", onSurface: "#1c2429", onSurfaceVariant: "#546e7a", outline: "#cfd8dc", error: "#b3261e" },
    dark: { primary: "#90a4ae", onPrimary: "#11181d", secondary: "#78909c", background: "#0f1216", surface: "#1a1f26", onSurface: "#eceff1", onSurfaceVariant: "#b0bec5", outline: "#37424c", error: "#ef9a9a" },
  },
  {
    id: "cosmic-void", name: "Cosmic Void", descriptionKey: "theme_description_cosmic_void",
    light: { primary: "#5b2de0", onPrimary: "#ffffff", secondary: "#7c4dff", background: "#fbf9ff", surface: "#f0ecfb", onSurface: "#1b1726", onSurfaceVariant: "#5b5470", outline: "#d6cfe6", error: "#b3261e" },
    dark: { primary: "#a384ff", onPrimary: "#1a0059", secondary: "#8c63ff", background: "#050505", surface: "#121212", onSurface: "#e8e3f5", onSurfaceVariant: "#b9b0cc", outline: "#2e2a38", error: "#ff8a80" },
  },
  {
    id: "cyberpunk", name: "Cyberpunk", descriptionKey: "theme_description_cyberpunk",
    light: { primary: "#a3008f", onPrimary: "#ffffff", secondary: "#00838f", background: "#fff7fe", surface: "#f6e9f7", onSurface: "#24102a", onSurfaceVariant: "#66506b", outline: "#dcc5df", error: "#ba1a1a" },
    dark: { primary: "#ff4df0", onPrimary: "#2b0029", secondary: "#00e5ff", background: "#0d001a", surface: "#1a0a2e", onSurface: "#f2e6ff", onSurfaceVariant: "#c4b0dd", outline: "#3d2a5a", error: "#ff5c8a" },
  },
  {
    id: "royal-gold", name: "Royal Gold", descriptionKey: "theme_description_royal_gold",
    light: { primary: "#7d6300", onPrimary: "#ffffff", secondary: "#9a7d12", background: "#fffdf5", surface: "#f7f0dc", onSurface: "#221c08", onSurfaceVariant: "#665c3d", outline: "#ddd2b0", error: "#ba1a1a" },
    dark: { primary: "#ffd700", onPrimary: "#2a2100", secondary: "#c5a000", background: "#050505", surface: "#141210", onSurface: "#fff8e1", onSurfaceVariant: "#d6c9a3", outline: "#3a3423", error: "#ffb4ab" },
  },
  {
    id: "cream-paper", name: "Cream Paper", descriptionKey: "theme_description_cream_paper",
    light: { primary: "#7f6157", onPrimary: "#ffffff", secondary: "#a1887f", background: "#fffbf0", surface: "#f5f5dc", onSurface: "#3e2723", onSurfaceVariant: "#6d5c52", outline: "#dcd3bd", error: "#b3261e" },
    dark: { primary: "#d7b7a8", onPrimary: "#3b2620", secondary: "#bcaaa4", background: "#1a1712", surface: "#25211a", onSurface: "#f1ebdf", onSurfaceVariant: "#cfc4b3", outline: "#4a4336", error: "#ffb4ab" },
  },
];

export const BUILTIN_THEMES = seeds.map(createTheme);

export const DEFAULT_THEME: ThemeDefinition = BUILTIN_THEMES[0]!;

export function isThemeVariant(value: string): value is ThemeVariant {
  return THEME_VARIANTS.includes(value as ThemeVariant);
}

function isThemeColors(value: unknown): value is ThemeColors {
  if (!value || typeof value !== "object") return false;
  const colors = value as Record<string, unknown>;
  const keys: (keyof ThemeColors)[] = [
    "primary", "onPrimary", "secondary", "background", "surface",
    "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh",
    "surfaceContainerHighest", "outline", "onSurface", "onSurfaceVariant", "error",
  ];
  return keys.every((key) => typeof colors[key] === "string" && (HEX_COLOR.test(colors[key]) || colors[key].startsWith("color-mix(")));
}

export const MAX_CUSTOM_THEMES = 24;

/** Accepts a list or a single theme object, the two shapes Flow for Android and desktop export. */
export function parseCustomThemes(serialized: string, limit = MAX_CUSTOM_THEMES): CustomThemeDefinition[] {
  try {
    const parsed: unknown = JSON.parse(serialized);
    const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    return candidates.filter((theme): theme is CustomThemeDefinition => {
      if (!theme || typeof theme !== "object") return false;
      const candidate = theme as Partial<CustomThemeDefinition>;
      return typeof candidate.id === "string"
        && candidate.id.startsWith("custom-")
        && typeof candidate.name === "string"
        && candidate.name.trim().length > 0
        && candidate.name.length <= 48
        && candidate.custom === true
        && !!candidate.variants
        && THEME_VARIANTS.every((variant) => isThemeColors(candidate.variants?.[variant]));
    }).slice(0, limit);
  } catch {
    return [];
  }
}

export function createCustomTheme(id: string, name: string): CustomThemeDefinition {
  return {
    id,
    name: name.trim(),
    custom: true,
    variants: structuredClone(DEFAULT_THEME.variants),
  };
}

export function resolveTheme(
  themeId: string,
  customThemes: readonly CustomThemeDefinition[],
): ThemeDefinition | CustomThemeDefinition {
  return customThemes.find((theme) => theme.id === themeId)
    ?? BUILTIN_THEMES.find((theme) => theme.id === themeId)
    ?? DEFAULT_THEME;
}

const LIGHT_CHROME = ["onSurface", "onSurface", "onSurface", "onSurfaceVariant", "onSurfaceVariant", "onSurfaceVariant", "onSurfaceVariant", "outline", "outline", "surfaceContainer", "background"] as const;
const DARK_CHROME = ["onSurface", "onSurface", "onSurface", "onSurfaceVariant", "onSurfaceVariant", "onSurfaceVariant", "onSurfaceVariant", "outline", "outline", "surfaceContainer", "background"] as const;
const CHROME_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

export function themeCssVariables(colors: ThemeColors, variant: ThemeVariant): Record<string, string> {
  const variables: Record<string, string> = {
    "--color-primary": colors.primary,
    "--color-primary-val": colors.primary,
    "--color-on-primary-val": colors.onPrimary,
    "--color-secondary-val": colors.secondary,
    "--color-background-val": colors.background,
    "--color-surface-val": colors.surface,
    "--color-surface-container-low-val": colors.surfaceContainerLow,
    "--color-surface-container-val": colors.surfaceContainer,
    "--color-surface-container-high-val": colors.surfaceContainerHigh,
    "--color-surface-container-highest-val": colors.surfaceContainerHighest,
    "--color-outline-variant-val": colors.outline,
    "--color-on-surface-val": colors.onSurface,
    "--color-on-surface-variant-val": colors.onSurfaceVariant,
    "--color-error": colors.error,
    "--color-chrome-toast": colors.surfaceContainerHigh,
    "--color-chrome-toast-border": colors.outline,
    "--color-chrome-popover": colors.surfaceContainer,
    "--color-chrome-searchbar": colors.surfaceContainerLow,
    "--color-chrome-dropdown": colors.surfaceContainer,
    "--color-chrome-input-surface": colors.surfaceContainerLow,
  };
  const roles = variant === "light" ? LIGHT_CHROME : DARK_CHROME;
  CHROME_STEPS.forEach((step, index) => {
    const role = roles[index]!;
    variables[`--color-chrome-neutral-${step}`] = colors[role];
    if (step !== "50") variables[`--color-chrome-zinc-${step}`] = colors[role];
  });
  return variables;
}

/** The variant a surface that always stays dark uses: AMOLED keeps its black, every other choice its dark set. */
export function darkVariantOf(variant: ThemeVariant): Exclude<ThemeVariant, "light"> {
  return variant === "amoled" ? "amoled" : "dark";
}

/**
 * One variant's tokens, scoped to one element. `-val` variables also get the
 * token Tailwind derives from them, because `@theme` resolves that token once
 * at the root and a descendant overriding only the `-val` would not move it.
 */
export function scopeVariables(theme: ThemeDefinition | CustomThemeDefinition, variant: ThemeVariant): Record<string, string> {
  const variables = themeCssVariables(theme.variants[variant], variant);
  for (const [name, value] of Object.entries(variables)) {
    if (name.endsWith("-val")) variables[name.slice(0, -"-val".length)] = value;
  }
  return variables;
}
