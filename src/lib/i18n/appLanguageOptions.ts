import { APP_LANGUAGES, getString } from "./index";

/** Each language by its own name, so someone can find theirs whatever the interface is in. */
export function appLanguageOptions(): { value: string; label: string }[] {
  const named = APP_LANGUAGES.map((tag) => {
    let label = tag;
    try {
      label = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
    } catch {
      label = tag;
    }
    return { value: tag, label };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: getString("settings_app_language_default") }, ...named];
}
