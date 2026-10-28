import { useRef, type KeyboardEvent } from "react";

export interface EmojiPickerProps {
  value: string;
  options: readonly string[];
  ariaLabel: string;
  onChange: (emoji: string) => void;
}

/** A fixed set of emoji as a radio group. */
export function EmojiPicker({ value, options, ariaLabel, onChange }: EmojiPickerProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next] ?? value);
    buttons.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((emoji, index) => {
        const selected = emoji === value;
        return (
          <button
            key={emoji}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={emoji}
            tabIndex={selected || (!options.includes(value) && index === 0) ? 0 : -1}
            onClick={() => onChange(emoji)}
            onKeyDown={(event) => move(event, index)}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition-colors duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-chrome-neutral-300 ${
              selected ? "bg-surface-container-highest" : "bg-surface-container hover:bg-surface-container-high"
            }`}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}
