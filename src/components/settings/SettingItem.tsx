import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { useNewSettingLabels } from '../../lib/settings/useNewSettingLabels';

export interface SettingItemProps {
  title: string;
  description?: string;
  disabled?: boolean;
  /** Optional leading glyph, for lists where the rows need to be scannable. */
  icon?: ReactNode;
  /** Makes the whole row a button that opens something, marked with a chevron. */
  onSelect?: () => void;
  /** Gives the title a status colour, such as the error red of a row that leaves or deletes. */
  titleClassName?: string;
  children?: ReactNode;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function SettingItem({ title, description, disabled = false, icon, onSelect, titleClassName, children }: SettingItemProps) {
  const isNew = useNewSettingLabels().has(title);
  const row = cx(
    'flex justify-between items-center px-5 py-4 transition-colors duration-200 ease-out',
    disabled ? 'opacity-50' : 'hover:bg-surface-row-hover'
  );
  const content = (
    <>
      {icon && <span className="me-3 shrink-0 text-chrome-neutral-400">{icon}</span>}
      <div className="flex-1 min-w-0 me-4">
        <div className={cx('flex items-center gap-2 text-sm font-medium', titleClassName ?? 'text-chrome-neutral-200')}>
          {title}
          {isNew && (
            <span role="img" aria-label={getString('settings_new_badge')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        {description && (
          <div className="text-xs text-chrome-neutral-400 mt-0.5">{description}</div>
        )}
      </div>
      {children !== undefined && <div className="shrink-0">{children}</div>}
      {onSelect && <ChevronRight size={16} className="shrink-0 text-chrome-neutral-500 rtl:-scale-x-100" />}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        data-setting-title={title}
        className={cx(row, 'w-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary')}
      >
        {content}
      </button>
    );
  }
  return (
    <div aria-disabled={disabled} data-setting-title={title} className={row}>
      {content}
    </div>
  );
}
