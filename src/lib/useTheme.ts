import { useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setNativeWindowBackground } from "./nativeWindowAppearance";
import { IS_MACOS_RUNTIME } from "./platform";
import { logToBackend } from "./diagnostics";
import { SETTINGS } from "./settings/schema";
import {
  DEFAULT_THEME,
  isThemeVariant,
  parseCustomThemes,
  resolveTheme,
  themeCssVariables,
  type CustomThemeDefinition,
  type ThemeVariant,
} from "./themes";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

export function useTheme() {
  const themeId = useAppSettingsStore((state) => state.values[SETTINGS.THEME_ID] ?? "default");
  const variantValue = useAppSettingsStore((state) => state.values[SETTINGS.THEME_VARIANT] ?? "dark");
  const serializedCustomThemes = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_THEMES] ?? "[]");
  const setSettingValue = useAppSettingsStore((state) => state.setSettingValue);
  const variant: ThemeVariant = isThemeVariant(variantValue) ? variantValue : "dark";
  const customThemes = useMemo(
    () => parseCustomThemes(serializedCustomThemes),
    [serializedCustomThemes],
  );
  const theme = useMemo(
    () => resolveTheme(themeId, customThemes),
    [customThemes, themeId],
  );

  return {
    theme,
    themeId,
    variant,
    customThemes,
    setTheme: (nextThemeId: string) => setSettingValue(SETTINGS.THEME_ID, nextThemeId),
    setVariant: (nextVariant: ThemeVariant) => setSettingValue(SETTINGS.THEME_VARIANT, nextVariant),
    saveCustomThemes: (themes: CustomThemeDefinition[]) =>
      setSettingValue(SETTINGS.CUSTOM_THEMES, JSON.stringify(themes)),
  };
}

export function ThemeController() {
  const { theme, variant } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    const colors = theme.variants[variant] ?? DEFAULT_THEME.variants.dark;
    const variables = themeCssVariables(colors, variant);
    Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
    root.dataset.theme = theme.id;
    root.dataset.themeVariant = variant;
    root.style.colorScheme = variant === "light" ? "light" : "dark";

    if (!IS_MACOS_RUNTIME) return;
    let disposed = false;
    const appWindow = getCurrentWindow();
    void appWindow.setTheme(variant === "light" ? "light" : "dark")
      .then(async () => {
        if (!disposed) await setNativeWindowBackground(colors.background);
      })
      .catch((cause) => {
        void logToBackend("warn", "native window appearance failed", { cause: String(cause) });
      });
    return () => { disposed = true; };
  }, [theme, variant]);

  return null;
}
