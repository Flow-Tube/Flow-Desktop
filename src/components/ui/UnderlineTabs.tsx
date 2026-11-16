import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface UnderlineTab<T extends string> {
  key: T;
  label: string;
}

/** Tabs that belong together; a group after the first is set apart by a divider and its icon. */
export interface UnderlineTabGroup<T extends string> {
  key: string;
  /** Names the group for screen readers. */
  label?: string;
  icon?: ReactNode;
  tabs: UnderlineTab<T>[];
}

interface UnderlineTabsProps<T extends string> {
  groups: UnderlineTabGroup<T>[];
  active: T | null;
  onChange: (key: T) => void;
  label: string;
  /** Takes the parent's height instead of its own. */
  fill?: boolean;
  className?: string;
}

const ARROW_STEPS: Record<string, number | undefined> = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 };

/**
 * A row of page tabs with the open one underlined. Arrow keys, Home and End move between them and
 * Enter or Space opens one, so passing over a tab never loads it.
 */
export function UnderlineTabs<T extends string>({ groups, active, onChange, label, fill = false, className = '' }: UnderlineTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = groups.flatMap((group) => group.tabs);
  const focusable = tabs.some((tab) => tab.key === active) ? active : tabs[0]?.key;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEPS[event.key];
    if (step === undefined) return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    // Arrows follow the reading direction, so they mirror in right-to-left languages.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next =
      event.key === 'Home' ? 0
        : event.key === 'End' ? buttons.length - 1
          : (current + (rtl ? -step : step) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`hide-scrollbar flex ${fill ? 'h-full' : 'h-12'} items-center gap-6 overflow-x-auto ${className}`}
    >
      {groups.map((group, index) => (
        <div key={group.key} role="presentation" className="flex h-full shrink-0 items-center gap-6">
          {index > 0 && (
            <span role="presentation" className="flex items-center gap-2 text-chrome-neutral-500" title={group.label}>
              <span className="h-5 w-px bg-outline-variant" />
              {group.icon}
            </span>
          )}
          {group.tabs.map((tab) => {
            const selected = tab.key === active;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={tab.key === focusable ? 0 : -1}
                onClick={() => onChange(tab.key)}
                className={`relative flex h-full items-center whitespace-nowrap rounded-sm text-sm font-semibold transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  selected ? 'text-chrome-neutral-100' : 'text-chrome-neutral-400 hover:text-chrome-neutral-100'
                }`}
              >
                {tab.label}
                {selected && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
