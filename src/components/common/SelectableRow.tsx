import type { ReactNode } from "react";
import { Check } from "lucide-react";

/** A row or card that, while picking, toggles on click instead of doing what it normally does. */
export function SelectableRow({
  selecting,
  selected,
  onToggle,
  card = false,
  children,
}: {
  selecting: boolean;
  selected: boolean;
  onToggle?: () => void;
  /** Marks a card in its corner, where a row is marked at its end. */
  card?: boolean;
  children: ReactNode;
}) {
  if (!selecting || !onToggle) return <div className="min-w-0">{children}</div>;
  return (
    <div
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      className={`relative cursor-pointer rounded-lg ring-2 transition-colors focus-visible:outline-none focus-visible:ring-primary ${
        selected ? "ring-[var(--color-primary)]" : "ring-transparent"
      }`}
    >
      <div className="pointer-events-none">{children}</div>
      <span
        className={`absolute z-10 grid h-6 w-6 place-items-center rounded-full border transition-colors ${
          card ? "right-2 top-2" : "right-3 top-1/2 -translate-y-1/2"
        } ${
          selected
            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
            : "border-chrome-neutral-600 bg-surface-container text-transparent"
        }`}
      >
        <Check size={14} />
      </span>
    </div>
  );
}
