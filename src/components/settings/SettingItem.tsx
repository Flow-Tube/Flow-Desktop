import type { ReactNode } from 'react';

export interface SettingItemProps {
  title: string;
  description?: string;
  disabled?: boolean;
  /** Optional leading glyph, for lists where the rows need to be scannable. */
  icon?: ReactNode;
  children: ReactNode;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function SettingItem({ title, description, disabled = false, icon, children }: SettingItemProps) {
  return (
    <div
      aria-disabled={disabled}
      className={cx(
        'flex justify-between items-center px-5 py-4 transition-colors duration-200 ease-out',
        disabled ? 'opacity-50' : 'hover:bg-surface-container'
      )}
    >
      {icon && <span className="mr-3 shrink-0 text-chrome-neutral-400">{icon}</span>}
      <div className="flex-1 min-w-0 mr-4">
        <div className="text-sm font-medium text-chrome-neutral-200">{title}</div>
        {description && (
          <div className="text-xs text-chrome-neutral-400 mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
