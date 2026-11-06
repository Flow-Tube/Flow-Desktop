import type { ReactNode } from 'react';

import { getString } from '../../lib/i18n/index';
import { useNewSettingLabels } from '../../lib/settings/useNewSettingLabels';

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
  const isNew = useNewSettingLabels().has(title);
  return (
    <div
      aria-disabled={disabled}
      data-setting-title={title}
      className={cx(
        'flex justify-between items-center px-5 py-4 transition-colors duration-200 ease-out',
        disabled ? 'opacity-50' : 'hover:bg-surface-container-highest'
      )}
    >
      {icon && <span className="mr-3 shrink-0 text-chrome-neutral-400">{icon}</span>}
      <div className="flex-1 min-w-0 mr-4">
        <div className="flex items-center gap-2 text-sm font-medium text-chrome-neutral-200">
          {title}
          {isNew && (
            <span role="img" aria-label={getString('settings_new_badge')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        {description && (
          <div className="text-xs text-chrome-neutral-400 mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
