import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body?: string;
  /** What to do about it, such as a button. */
  children?: ReactNode;
}

/** A page or list with nothing to show. */
export function EmptyState({ icon: Icon, title, body, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
      <Icon className="mb-4 h-12 w-12 text-chrome-neutral-700" />
      <h3 className="font-bold text-chrome-neutral-300">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
