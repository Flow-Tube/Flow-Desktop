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
  resolveThemeChoice,
  themeCssVariables,
  type CustomThemeDefinition,
  type ThemeVariant,
} from "./themes";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useThemeFileStore } from "../store/useThemeFileStore";
import { THEME_FILE_ID } from "./themeFile";
import { useSystemDarkMode } from "./useSystemDarkMode";
import { useThemeFileSync } from "./useThemeFile";
import { saveBootTheme } from "./profiles/bootTheme";

export function useTheme() {
  const pickedThemeId = useAppSettingsStore((state) => state.values[SETTINGS.THEME_ID] ?? "default");
  const variantValue = useAppSettingsStore((state) => state.values[SETTINGS.THEME_VARIANT] ?? "dark");
  const followSystem = useAppSettingsStore((state) => state.values[SETTINGS.THEME_FOLLOW_SYSTEM] === "true");
  const lightThemeId = useAppSettingsStore((state) => state.values[SETTINGS.THEME_LIGHT_ID] ?? "default");
  const darkThemeId = useAppSettingsStore((state) => state.values[SETTINGS.THEME_DARK_ID] ?? "default");
  const darkStyle = useAppSettingsStore((state) => state.values[SETTINGS.THEME_DARK_STYLE] === "amoled" ? "amoled" : "dark");
  const systemDark = useSystemDarkMode();
  const serializedCustomThemes = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_THEMES] ?? "[]");
  const setSettingValue = useAppSettingsStore((state) => state.setSettingValue);
  const { themeId, variant: choiceVariant } = resolveThemeChoice({
    themeId: pickedThemeId,
    variant: isThemeVariant(variantValue) ? variantValue : "dark",
    followSystem,
    systemDark,
    lightThemeId,
    darkThemeId,
    darkStyle,
  });
  const fileTheme = useThemeFileStore((state) => (themeId === THEME_FILE_ID ? state.applied : null));
  // The theme file sets its own light or dark, so a shell switching schemes switches Flow too.
  const variant: ThemeVariant = fileTheme?.scheme ?? choiceVariant;
  const customThemes = useMemo(
    () => parseCustomThemes(serializedCustomThemes),
    [serializedCustomThemes],
  );
  const theme = useMemo(
    () => fileTheme?.theme ?? resolveTheme(themeId, customThemes),
    [customThemes, fileTheme, themeId],
  );

  return {
    theme,
    themeId,
    variant,
    customThemes,
    followSystem,
    systemDark,
    // With Follow system on, a palette picked on the page is for the mode the system is in now.
    setTheme: (nextThemeId: string) =>
      setSettingValue(
        followSystem ? (systemDark ? SETTINGS.THEME_DARK_ID : SETTINGS.THEME_LIGHT_ID) : SETTINGS.THEME_ID,
        nextThemeId,
      ),
    setVariant: (nextVariant: ThemeVariant) => setSettingValue(SETTINGS.THEME_VARIANT, nextVariant),
    saveCustomThemes: (themes: CustomThemeDefinition[]) =>
      setSettingValue(SETTINGS.CUSTOM_THEMES, JSON.stringify(themes)),
  };
}

export function ThemeController() {
  const { theme, themeId, variant, followSystem } = useTheme();
  const appFont = useAppSettingsStore((state) => state.values[SETTINGS.APP_FONT] ?? "inter");
  const settingsLoaded = useAppSettingsStore((state) => state.loaded);
  useThemeFileSync(themeId === THEME_FILE_ID);

  // Only once settings are in: the schema defaults shown before must not replace the snapshot.
  useEffect(() => {
    if (!settingsLoaded) return;
    saveBootTheme(theme.id, theme.variants[variant] ?? DEFAULT_THEME.variants.dark, variant);
  }, [settingsLoaded, theme, variant]);

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
    // A window forced to a mode makes the system query report that mode, so Follow system lets go of it.
    void appWindow.setTheme(followSystem ? null : variant === "light" ? "light" : "dark")
      .then(async () => {
        if (!disposed) await setNativeWindowBackground(colors.background);
      })
      .catch((cause) => {
        void logToBackend("warn", "native window appearance failed", { cause: String(cause) });
      });
    return () => { disposed = true; };
  }, [followSystem, theme, variant]);

  useEffect(() => {
    document.documentElement.dataset.appFont = appFont;
  }, [appFont]);

  return null;
}
