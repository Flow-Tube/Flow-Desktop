import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { profileColorClasses } from "./ProfileAvatar";

export interface ColorSwatchPickerProps {
  value: string;
  options: readonly string[];
  /** The spoken name of each colour. */
  labels: Record<string, string>;
  ariaLabel: string;
  onChange: (value: string) => void;
}

/** One of the profile colours, as a radio group; the choice is marked with a check, not a border. */
export function ColorSwatchPicker({ value, options, labels, ariaLabel, onChange }: ColorSwatchPickerProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next] ?? value);
    buttons.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const selected = option === value;
        return (
          <button
            key={option}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={labels[option] ?? option}
            tabIndex={selected || (!options.includes(value) && index === 0) ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(event) => move(event, index)}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-200 ease-out hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chrome-neutral-300 ${profileColorClasses(option)}`}
          >
            {selected ? <Check className="h-4 w-4" /> : null}
          </button>
        );
      })}
    </div>
  );
}
