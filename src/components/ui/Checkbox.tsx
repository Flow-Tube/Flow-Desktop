import type { ReactNode } from "react";
import { Check } from "lucide-react";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

/** A labelled checkbox: a native input for keyboard and screen readers, drawn as a box. */
export function Checkbox({ checked, onChange, disabled, children, className = "" }: CheckboxProps) {
  return (
    <label
      className={`flex items-center gap-3 ${disabled ? "cursor-default opacity-50" : "cursor-pointer"} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-chrome-neutral-700 bg-surface-container transition-colors duration-200 ease-out peer-checked:border-[var(--color-primary)] peer-checked:bg-[var(--color-primary)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-chrome-neutral-300">
        {checked ? <Check size={14} className="text-[var(--color-on-primary)]" /> : null}
      </span>
      {children}
    </label>
  );
}
