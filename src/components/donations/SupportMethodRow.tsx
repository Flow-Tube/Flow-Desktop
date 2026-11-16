import type { ReactNode } from "react";

interface SupportMethodRowProps {
  icon: ReactNode;
  title: string;
  badge?: string;
  description: string;
  action: ReactNode;
}

/** One way to give, laid out like a settings row so the page reads as one list. */
export function SupportMethodRow({ icon, title, badge, description, action }: SupportMethodRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-100">
        {icon}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-chrome-neutral-100">{title}</h2>
          {badge && (
            <span className="rounded-full border border-chrome-neutral-700 px-2 py-0.5 text-[11px] font-semibold text-chrome-neutral-300">{badge}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-chrome-neutral-400">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
