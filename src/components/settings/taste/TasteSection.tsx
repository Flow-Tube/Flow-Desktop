import type { ReactNode } from "react";

interface TasteSectionProps {
  title: string;
  description: string;
  /** A button beside the title. */
  action?: ReactNode;
  children: ReactNode;
}

/** One full-width card of Your taste. */
export function TasteSection({ title, description, action, children }: TasteSectionProps) {
  return (
    <section className="col-span-12 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium text-chrome-neutral-200">{title}</h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
