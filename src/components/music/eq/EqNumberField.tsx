import { useEffect, useState } from "react";

export interface EqNumberFieldProps {
  value: number;
  decimals: number;
  unit?: string;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (value: number) => void;
}

/**
 * A number typed in full before it applies: committing on every keystroke would play "1", then
 * "10", then "100" Hz on the way to 1000.
 */
export function EqNumberField({ value, decimals, unit, disabled, ariaLabel, onCommit }: EqNumberFieldProps) {
  const shown = value.toFixed(decimals);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (Number.isFinite(parsed) && draft.trim() !== "") onCommit(parsed);
    else setDraft(shown);
  };

  return (
    <label className="flex items-center gap-1 rounded-md border border-chrome-neutral-800 bg-surface-container-low px-2 py-1 transition-colors duration-200 ease-out focus-within:border-chrome-neutral-600">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            // Escape undoes the typing; the dialog around the field stays open.
            event.stopPropagation();
            setDraft(shown);
          }
        }}
        className="w-14 bg-transparent font-mono text-xs tabular-nums text-chrome-neutral-100 outline-none disabled:opacity-40"
      />
      {unit && <span className="text-[10px] text-chrome-neutral-500">{unit}</span>}
    </label>
  );
}
