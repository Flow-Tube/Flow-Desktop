import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  stretch?: boolean;
  className?: string;
}

/** A pill row of mutually exclusive choices; the chosen one sits on the surface. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  stretch = false,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${stretch ? "flex w-full" : "inline-flex"} gap-0.5 rounded-full border border-chrome-neutral-800 bg-surface-container-low p-[3px] ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`${stretch ? "flex-1 justify-center px-2" : "inline-flex px-3.5"} inline-flex h-8 items-center gap-1.5 rounded-full text-sm font-medium transition-colors duration-200 ease-out ${
              selected
                ? "bg-surface text-chrome-neutral-100 ring-1 ring-chrome-neutral-800"
                : "text-chrome-neutral-400 hover:text-chrome-neutral-200"
            }`}
          >
            {option.icon && <span className="shrink-0">{option.icon}</span>}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
