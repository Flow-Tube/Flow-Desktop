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
  /** Spreads the options evenly over the full width. */
  stretch?: boolean;
  /** Shows only each option's icon; the label still names it for screen readers and on hover. */
  iconOnly?: boolean;
}

/** A pill row of mutually exclusive choices; the chosen one sits on the surface. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  stretch = false,
  iconOnly = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${stretch ? "flex w-full" : "inline-flex"} gap-0.5 rounded-full border border-chrome-neutral-800 bg-surface-container-low p-[3px]`}
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
            title={iconOnly ? option.label : undefined}
            className={`${stretch ? "flex-1 justify-center px-2" : iconOnly ? "w-8 justify-center" : "inline-flex px-3.5"} inline-flex h-8 items-center gap-1.5 rounded-full text-sm font-medium transition-colors duration-200 ease-out ${
              selected
                ? "bg-surface text-chrome-neutral-100 ring-1 ring-chrome-neutral-800"
                : "text-chrome-neutral-400 hover:text-chrome-neutral-200"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
          >
            {option.icon && <span className="shrink-0">{option.icon}</span>}
            <span className={iconOnly ? "sr-only" : "truncate"}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
