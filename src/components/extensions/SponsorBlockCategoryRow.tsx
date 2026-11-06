import { getString } from "../../lib/i18n/index";
import { useState, type MouseEvent } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Select } from "../ui/Select";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import type { SponsorBlockAction } from "../../store/useSettingsStore";

const PRESET_COLORS = [
  "#00D400", "#FFFF00", "#0000FF", "#FF0000", "#FF7700", "#FF69B4",
  "#7700FF", "#00FFFF", "#FFFFFF", "#008080", "#3F51B5", "#FFC107",
  "#CDDC39", "#673AB7", "#FF5722", "#E91E63", "#006400", "#8B4513",
  "#808080", "#C0C0C0", "#FFD700", "#40E0D0", "#4B0082",
];

const ACTION_OPTIONS: { value: SponsorBlockAction; label: string }[] = [
  { value: "skip", label: getString('sponsorblock_auto_skip') },
  { value: "mute", label: getString('sponsorblock_mute_audio') },
  { value: "notify", label: getString('sponsorblock_show_skip_button') },
  { value: "ignore", label: getString('sponsorblock_ignore') },
];

export interface SponsorBlockCategoryRowProps {
  name: string;
  description: string;
  color: string;
  action: SponsorBlockAction;
  defaultColor: string;
  onColorChange: (color: string) => void;
  onActionChange: (action: SponsorBlockAction) => void;
}

export function SponsorBlockCategoryRow({
  name,
  description,
  color,
  action,
  defaultColor,
  onColorChange,
  onActionChange,
}: SponsorBlockCategoryRowProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const togglePicker = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor((current) => (current ? null : { top: rect.bottom + 8, left: rect.left }));
  };

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-200 ease-out hover:bg-surface-container">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={togglePicker}
          aria-label={`Customize ${name} color`}
          className="h-6 w-6 shrink-0 rounded-full border border-chrome-neutral-700 transition-transform duration-200 ease-out hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0">
          <div className="text-sm font-medium text-chrome-neutral-200">{name}</div>
          <div className="mt-0.5 text-xs text-chrome-neutral-400">{description}</div>
        </div>
      </div>

      <Select
        value={action}
        onChange={(value) => onActionChange(value as SponsorBlockAction)}
        options={ACTION_OPTIONS}
        className="w-44"
      />

      {anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          className="z-50 w-56 rounded-xl border border-chrome-neutral-800 bg-surface-container-high p-3"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              Segment color
            </span>
            <button
              type="button"
              onClick={() => {
                onColorChange(defaultColor);
                setAnchor(null);
              }}
              className="flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] transition-opacity duration-200 ease-out hover:opacity-80"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_COLORS.map((preset) => {
              const active = preset.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onColorChange(preset);
                    setAnchor(null);
                  }}
                  aria-label={preset}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-chrome-neutral-700 transition-transform duration-200 ease-out hover:scale-110"
                  style={{ backgroundColor: preset }}
                >
                  {active && <Check size={12} className="stroke-[3] text-chrome-black/80" />}
                </button>
              );
            })}
          </div>
        </AnchoredPortalMenu>
      )}
    </div>
  );
}
