import { useState } from "react";
import { Plus } from "lucide-react";
import { CustomThemeEditor } from "../../theme/CustomThemeEditor";
import { ThemePreview } from "../../theme/ThemePreview";
import { Button } from "../../ui/Button";
import { getString } from "../../../lib/i18n/index";
import {
  BUILTIN_THEMES,
  THEME_VARIANTS,
  createCustomTheme,
  type CustomThemeDefinition,
} from "../../../lib/themes";
import { useTheme } from "../../../lib/useTheme";

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
    if (!window.confirm(getString("theme_delete_confirm", theme.name))) return;
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
        <Button onClick={createTheme} disabled={customThemes.length >= 24}>
          <Plus size={17} />
          {getString("theme_create")}
        </Button>
      </div>

      <section className="mt-8 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
        <div>
          <h2 className="text-base font-medium text-chrome-neutral-200">{getString("theme_variant")}</h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">{getString("theme_variant_description")}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {THEME_VARIANTS.map((item) => (
            <Button key={item} variant={variant === item ? "primary" : "secondary"} onClick={() => void setVariant(item)}>
              {getString(`theme_variant_${item}` as Parameters<typeof getString>[0])}
            </Button>
          ))}
        </div>
      </section>

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
            <span className="font-mono text-xs text-chrome-neutral-500">{customThemes.length}/24</span>
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
        />
      )}
    </div>
  );
}
