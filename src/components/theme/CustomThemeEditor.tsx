import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";
import {
  THEME_VARIANTS,
  type CustomThemeDefinition,
  type ThemeColors,
  type ThemeVariant,
} from "../../lib/themes";

interface CustomThemeEditorProps {
  theme: CustomThemeDefinition;
  onCancel: () => void;
  onSave: (theme: CustomThemeDefinition) => void;
}

const colorFields: { key: keyof ThemeColors; labelKey: Parameters<typeof getString>[0] }[] = [
  { key: "primary", labelKey: "theme_color_primary" },
  { key: "onPrimary", labelKey: "theme_color_on_primary" },
  { key: "secondary", labelKey: "theme_color_secondary" },
  { key: "background", labelKey: "theme_color_background" },
  { key: "surface", labelKey: "theme_color_surface" },
  { key: "surfaceContainerLow", labelKey: "theme_color_surface_low" },
  { key: "surfaceContainer", labelKey: "theme_color_surface_container" },
  { key: "surfaceContainerHigh", labelKey: "theme_color_surface_high" },
  { key: "surfaceContainerHighest", labelKey: "theme_color_surface_highest" },
  { key: "onSurface", labelKey: "theme_color_text" },
  { key: "onSurfaceVariant", labelKey: "theme_color_muted_text" },
  { key: "outline", labelKey: "theme_color_outline" },
  { key: "error", labelKey: "theme_color_error" },
];

export function CustomThemeEditor({ theme, onCancel, onSave }: CustomThemeEditorProps) {
  const [draft, setDraft] = useState(() => structuredClone(theme));
  const [variant, setVariant] = useState<ThemeVariant>("dark");

  useEffect(() => setDraft(structuredClone(theme)), [theme]);

  const setColor = (key: keyof ThemeColors, value: string) => {
    setDraft((current) => ({
      ...current,
      variants: {
        ...current.variants,
        [variant]: { ...current.variants[variant], [key]: value },
      },
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/70 p-6" role="dialog" aria-modal="true" aria-labelledby="custom-theme-title">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-chrome-neutral-800 bg-background">
        <header className="flex items-center justify-between border-b border-chrome-neutral-800 px-6 py-4">
          <div>
            <h2 id="custom-theme-title" className="text-lg font-semibold text-chrome-neutral-100">{getString("theme_editor_title")}</h2>
            <p className="mt-1 text-sm text-chrome-neutral-400">{getString("theme_editor_description")}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={getString("theme_cancel")} className="cursor-pointer rounded-full p-2 text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100">
            <X size={18} />
          </button>
        </header>

        <div className="overflow-y-auto p-6 scrollbar-none">
          <label className="block text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500" htmlFor="theme-name">{getString("theme_name")}</label>
          <input
            id="theme-name"
            value={draft.name}
            maxLength={48}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            className="mt-2 w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 text-sm text-chrome-neutral-100 outline-none transition-colors focus:border-chrome-neutral-500"
          />

          <div className="mt-6 flex gap-2" role="tablist" aria-label={getString("theme_variant") }>
            {THEME_VARIANTS.map((item) => (
              <Button key={item} role="tab" aria-selected={variant === item} variant={variant === item ? "primary" : "secondary"} onClick={() => setVariant(item)}>
                {getString(`theme_variant_${item}` as Parameters<typeof getString>[0])}
              </Button>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {colorFields.map((field) => {
              const value = draft.variants[variant][field.key];
              const isHex = /^#[0-9a-f]{6}$/i.test(value);
              return (
                <label key={field.key} className="flex items-center gap-3 rounded-xl border border-chrome-neutral-800 bg-surface-container-low p-3 text-sm text-chrome-neutral-300">
                  <input type="color" value={isHex ? value : draft.variants[variant].surface} onChange={(event) => setColor(field.key, event.target.value)} className="h-9 w-11 cursor-pointer rounded-md border-0 bg-transparent" />
                  <span className="min-w-0 flex-1 truncate">{getString(field.labelKey)}</span>
                  <span className="font-mono text-xs text-chrome-neutral-500">{value}</span>
                </label>
              );
            })}
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-chrome-neutral-800 px-6 py-4">
          <Button variant="secondary" onClick={onCancel}>{getString("theme_cancel")}</Button>
          <Button disabled={!draft.name.trim()} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>{getString("theme_save")}</Button>
        </footer>
      </div>
    </div>
  );
}
