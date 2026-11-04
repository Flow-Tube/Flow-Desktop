import { useRef, useState, type ChangeEvent } from "react";
import { Download, Plus, Upload } from "lucide-react";
import { CustomThemeEditor } from "../../theme/CustomThemeEditor";
import { ThemeFileSection } from "../../theme/ThemeFileSection";
import { ThemePreview } from "../../theme/ThemePreview";
import { Button } from "../../ui/Button";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useBoolPref } from "../../../lib/usePreference";
import { SETTINGS } from "../../../lib/settings/schema";
import { confirmAction } from "../../../lib/dialogs";
import { getString } from "../../../lib/i18n/index";
import {
  BUILTIN_THEMES,
  MAX_CUSTOM_THEMES,
  THEME_VARIANTS,
  createCustomTheme,
  type CustomThemeDefinition,
} from "../../../lib/themes";
import { THEME_FILE_ID } from "../../../lib/themeFile";
import { useTheme } from "../../../lib/useTheme";
import { useThemeTransfer } from "../../../lib/useThemeTransfer";
import { IS_LINUX_RUNTIME } from "../../../lib/platform";
import { GraphicsCompatibilitySection } from "../GraphicsCompatibilitySection";

export function AppearanceTab() {
  const {
    themeId,
    variant,
    customThemes,
    setTheme,
    setVariant,
    saveCustomThemes,
  } = useTheme();
  const [editingTheme, setEditingTheme] = useState<CustomThemeDefinition | null>(null);
  const [expressiveSliders, setExpressiveSliders] = useBoolPref(SETTINGS.EXPRESSIVE_SLIDERS_ENABLED, true);
  const { exportThemes, importThemes } = useThemeTransfer();
  const importInputRef = useRef<HTMLInputElement>(null);
  const usingThemeFile = themeId === THEME_FILE_ID;

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importThemes(file);
  };

  const createTheme = () => {
    const id = `custom-${crypto.randomUUID()}`;
    setEditingTheme(createCustomTheme(id, getString("theme_new_name")));
  };

  const saveTheme = async (theme: CustomThemeDefinition) => {
    const nextThemes = customThemes.some((item) => item.id === theme.id)
      ? customThemes.map((item) => item.id === theme.id ? theme : item)
      : [...customThemes, theme];
    const saved = await saveCustomThemes(nextThemes);
    if (saved) {
      await setTheme(theme.id);
      setEditingTheme(null);
    }
  };

  const deleteTheme = async (theme: CustomThemeDefinition) => {
    const confirmed = await confirmAction({
      title: getString("settings_custom_theme_delete_title", theme.name),
      message: getString("settings_custom_theme_delete_body"),
      confirmLabel: getString("delete"),
      destructive: true,
    });
    if (!confirmed) return;
    const saved = await saveCustomThemes(customThemes.filter((item) => item.id !== theme.id));
    if (saved && themeId === theme.id) await setTheme("default");
  };

  return (
    <div className="mx-auto max-w-5xl pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("settings_appearance")}</h1>
          <p className="mt-2 text-sm text-chrome-neutral-400">{getString("theme_page_description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => importInputRef.current?.click()} disabled={customThemes.length >= MAX_CUSTOM_THEMES}>
            <Upload size={17} />
            {getString("theme_import")}
          </Button>
          <Button variant="secondary" onClick={() => void exportThemes(customThemes)} disabled={customThemes.length === 0}>
            <Download size={17} />
            {getString("theme_export_all")}
          </Button>
          <Button onClick={createTheme} disabled={customThemes.length >= MAX_CUSTOM_THEMES}>
            <Plus size={17} />
            {getString("theme_create")}
          </Button>
          <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImportFile} className="hidden" />
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
        <div>
          <h2 className="text-base font-medium text-chrome-neutral-200">{getString("theme_variant")}</h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">
            {getString(usingThemeFile ? "theme_variant_from_file" : "theme_variant_description")}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {THEME_VARIANTS.map((item) => (
            <Button key={item} variant={variant === item ? "primary" : "secondary"} onClick={() => void setVariant(item)} disabled={usingThemeFile}>
              {getString(`theme_variant_${item}` as Parameters<typeof getString>[0])}
            </Button>
          ))}
        </div>
      </section>

      <section className="mt-8 flex items-center justify-between gap-6 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-chrome-neutral-200">{getString("settings_expressive_sliders")}</h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">{getString("settings_expressive_sliders_desc")}</p>
        </div>
        <ToggleSwitch checked={expressiveSliders} onChange={setExpressiveSliders} />
      </section>

      {IS_LINUX_RUNTIME && <GraphicsCompatibilitySection />}

      <ThemeFileSection />

      <section className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-chrome-neutral-200">{getString("theme_presets")}</h2>
            <p className="mt-1 text-sm text-chrome-neutral-400">{getString("theme_presets_description")}</p>
          </div>
          <span className="font-mono text-xs text-chrome-neutral-500">{BUILTIN_THEMES.length}</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {BUILTIN_THEMES.map((theme) => (
            <ThemePreview
              key={theme.id}
              name={theme.name}
              description={getString(theme.descriptionKey)}
              colors={theme.variants[variant]}
              selected={themeId === theme.id}
              selectLabel={getString("theme_select")}
              editLabel={getString("theme_edit")}
              deleteLabel={getString("theme_delete")}
              onSelect={() => void setTheme(theme.id)}
            />
          ))}
        </div>
      </section>

      {customThemes.length > 0 && (
        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-medium text-chrome-neutral-200">{getString("theme_custom")}</h2>
              <p className="mt-1 text-sm text-chrome-neutral-400">{getString("theme_custom_description")}</p>
            </div>
            <span className="font-mono text-xs text-chrome-neutral-500">{customThemes.length}/{MAX_CUSTOM_THEMES}</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {customThemes.map((theme) => (
              <ThemePreview
                key={theme.id}
                name={theme.name}
                description={getString("theme_custom_card_description")}
                colors={theme.variants[variant]}
                selected={themeId === theme.id}
                custom
                selectLabel={getString("theme_select")}
                editLabel={getString("theme_edit")}
                deleteLabel={getString("theme_delete")}
                onSelect={() => void setTheme(theme.id)}
                onEdit={() => setEditingTheme(theme)}
                onDelete={() => void deleteTheme(theme)}
              />
            ))}
          </div>
        </section>
      )}

      {editingTheme && (
        <CustomThemeEditor
          theme={editingTheme}
          onCancel={() => setEditingTheme(null)}
          onSave={(theme) => void saveTheme(theme)}
          onExport={(theme) => void exportThemes([theme])}
        />
      )}
    </div>
  );
}
