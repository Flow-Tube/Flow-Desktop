import { useUiStore } from "../store/useUiStore";
import { getString } from "./i18n/index";
import { saveJsonFile } from "./saveJsonFile";
import { customThemesFileName, customThemesJson, mergeImportedThemes } from "./themeTransfer";
import type { CustomThemeDefinition } from "./themes";
import { useTheme } from "./useTheme";

export function useThemeTransfer() {
  const { customThemes, saveCustomThemes } = useTheme();
  const showToast = useUiStore((state) => state.showToast);

  const exportThemes = async (themes: readonly CustomThemeDefinition[]) => {
    if (themes.length === 0) return;
    try {
      const saved = await saveJsonFile(getString("theme_export"), customThemesFileName(themes), customThemesJson(themes));
      if (saved) showToast({ message: getString("theme_export_success"), variant: "success" });
    } catch (cause) {
      console.error("Theme export failed", cause);
      showToast({ message: getString("theme_export_failed"), variant: "error" });
    }
  };

  const importThemes = async (file: File) => {
    let serialized: string;
    try {
      serialized = await file.text();
    } catch {
      showToast({ message: getString("theme_import_invalid"), variant: "error" });
      return;
    }
    const result = mergeImportedThemes(customThemes, serialized);
    if (result.added === 0) {
      const message = result.overLimit > 0 ? getString("theme_import_full") : getString("theme_import_invalid");
      showToast({ message, variant: "error" });
      return;
    }
    if (!await saveCustomThemes(result.themes)) {
      showToast({ message: getString("theme_import_failed"), variant: "error" });
      return;
    }
    const message = result.overLimit > 0
      ? getString("theme_import_partial", result.added, result.overLimit)
      : getString("theme_import_success", result.added);
    showToast({ message, variant: "success" });
  };

  return { exportThemes, importThemes };
}
