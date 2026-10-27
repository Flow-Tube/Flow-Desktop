import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { AnchoredPortalMenu, type MenuAnchor } from './AnchoredPortalMenu';

export interface FilterSelectOption<T extends string> {
  value: T;
  label: string;
}

export interface FilterSelectProps<T extends string> {
  label?: string;
  value: T;
  options: FilterSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}


export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: FilterSelectProps<T>) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setAnchor(null), []);
  const open = anchor !== null;

  const toggle = () => {
    if (anchor) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ top: rect.bottom + 8, flipBottom: rect.top - 8, right: rect.right });
  };

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={cx('relative shrink-0', className)}>
      <button
        ref={buttonRef}
        type="button"
        // The open list closes on any outside press; this keeps that press from reopening it.
        onMouseDown={(event) => {
          if (anchor) event.stopPropagation();
        }}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-chrome-neutral-800 bg-surface-container-high px-3 text-sm text-neutral-00 transition-colors duration-200 ease-out hover:bg-surface-container-highest focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        {label && <span className="text-chrome-neutral-500">{label}:</span>}
        <span className="font-medium">{current?.label}</span>
        <ChevronDown
          className={cx('h-4 w-4 text-chrome-neutral-400 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={close}
          className="z-[130] max-h-72 min-w-[12rem] overflow-y-auto rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <div role="listbox">
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

export default FilterSelect;
