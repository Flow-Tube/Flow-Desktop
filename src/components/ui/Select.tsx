import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { AnchoredPortalMenu, type MenuAnchor } from './AnchoredPortalMenu';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
}

const LIST_GAP = 8;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Select({ value, onChange, options, disabled, className = '' }: SelectProps) {
  const [anchor, setAnchor] = useState<(MenuAnchor & { width: number }) | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setAnchor(null), []);

  // The list floats in a portal so a scrolling container, such as a dialog body,
  // never grows or clips around it.
  const toggle = () => {
    if (anchor) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      top: rect.bottom + LIST_GAP,
      flipBottom: rect.top - LIST_GAP,
      right: rect.right,
      width: rect.width,
    });
  };

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={cx('relative shrink-0', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        // The open list closes on any outside press; this keeps that press from
        // reopening it through the click below.
        onMouseDown={(event) => {
          if (anchor) event.stopPropagation();
        }}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        className="inline-flex h-10 w-full items-center justify-between gap-1.5 rounded-lg border border-chrome-neutral-800 bg-surface-container-high px-3 text-sm text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-highest focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="font-medium">{current?.label}</span>
        <ChevronDown
          className={cx('h-4 w-4 text-chrome-neutral-400 transition-transform duration-200', anchor && 'rotate-180')}
        />
      </button>

      {anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={close}
          className="z-[130] max-h-60 min-w-[12rem] overflow-y-auto rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <div role="listbox" style={{ minWidth: anchor.width }}>
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-sm text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100"
                >
                  <span className={active ? 'text-chrome-neutral-100' : undefined}>{o.label}</span>
                  {active && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
                </button>
              );
            })}
          </div>
        </AnchoredPortalMenu>
      )}
    </div>
  );
}
