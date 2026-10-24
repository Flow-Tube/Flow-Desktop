import { MAX_CUSTOM_THEMES, parseCustomThemes, type CustomThemeDefinition } from "./themes";

/** One theme exports as a bare object and several as a list, the format Flow for Android reads. */
export function customThemesJson(themes: readonly CustomThemeDefinition[]): string {
  return JSON.stringify(themes.length === 1 ? themes[0] : themes, null, 2);
}

export function customThemesFileName(themes: readonly CustomThemeDefinition[]): string {
  if (themes.length !== 1) return "flow_themes.json";
  const slug = themes[0]!.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `flow_theme_${slug || "custom"}.json`;
}

export interface ThemeImportResult {
  themes: CustomThemeDefinition[];
  added: number;
  /** Valid themes left out because the list was already full. */
  overLimit: number;
}

export function mergeImportedThemes(
  existing: readonly CustomThemeDefinition[],
  serialized: string,
  newId: () => string = () => `custom-${crypto.randomUUID()}`,
): ThemeImportResult {
  const incoming = parseCustomThemes(serialized, Number.POSITIVE_INFINITY);
  const themes = [...existing];
  const taken = new Set(existing.map((theme) => theme.id));
  let added = 0;
  for (const theme of incoming) {
    if (themes.length >= MAX_CUSTOM_THEMES) break;
    let id = theme.id;
    while (taken.has(id)) id = newId();
    taken.add(id);
    themes.push({ ...theme, id, name: theme.name.trim() });
    added += 1;
  }
  return { themes, added, overLimit: incoming.length - added };
}
