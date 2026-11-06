import { Check, Pencil, Trash2 } from "lucide-react";
import type { ThemeColors } from "../../lib/themes";

interface ThemePreviewProps {
  name: string;
  description: string;
  colors: ThemeColors;
  selected: boolean;
  custom?: boolean;
  selectLabel: string;
  editLabel: string;
  deleteLabel: string;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ThemePreview({
  name,
  description,
  colors,
  selected,
  custom,
  selectLabel,
  editLabel,
  deleteLabel,
  onSelect,
  onEdit,
  onDelete,
}: ThemePreviewProps) {
  const swatches = [colors.primary, colors.onSurfaceVariant, colors.surfaceContainerHighest];

  return (
    <div className={`flex min-w-0 items-center rounded-2xl border transition-colors ${selected ? "border-chrome-neutral-500 bg-surface-container-high" : "border-chrome-neutral-800 bg-surface-container-low hover:bg-surface-container"}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${selectLabel}: ${name}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 p-4 text-start"
      >
        <span className="flex h-12 w-16 shrink-0 items-center justify-center gap-1 rounded-xl border border-chrome-neutral-800 bg-background">
          {swatches.map((color, index) => (
            <span key={index} className="h-7 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-chrome-neutral-100">
            <span className="truncate">{name}</span>
            {selected && <Check size={16} className="shrink-0 text-[var(--color-primary)]" />}
          </span>
          <span className="mt-1 block truncate text-xs text-chrome-neutral-400">{description}</span>
        </span>
      </button>
      {custom && (
        <div className="me-3 flex shrink-0 items-center gap-1">
          <button type="button" onClick={onEdit} aria-label={`${editLabel}: ${name}`} className="cursor-pointer rounded-full p-2 text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100">
            <Pencil size={16} />
          </button>
          <button type="button" onClick={onDelete} aria-label={`${deleteLabel}: ${name}`} className="cursor-pointer rounded-full p-2 text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-[var(--color-error)]">
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
