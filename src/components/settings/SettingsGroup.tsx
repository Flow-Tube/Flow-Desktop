import type { ReactNode } from 'react';

export interface SettingsGroupProps {
  title?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <div className="space-y-2">
      {title && (
        <h3 className="text-sm font-semibold text-primary px-1">
          {title}
        </h3>
      )}
      <div className="flex flex-col gap-0.5 [&>*]:rounded-[4px] [&>*]:bg-surface-container-high [&>*:first-child]:rounded-t-2xl [&>*:last-child]:rounded-b-2xl">
        {children}
      </div>
    </div>
  );
}
