import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { getString } from "../../lib/i18n/index";

/** One thing to do on the Sync page, opened from its list: a back arrow, a title, then the task. */
export function SyncTaskView({
  title,
  subtitle,
  error,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  /** Left out while the task is under way and has its own way out. */
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={getString("sync_back")}
            title={getString("sync_back")}
            className="-ms-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
          </button>
        )}
        <div className="min-w-0 pt-0.5">
          <h1 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-chrome-neutral-400">{subtitle}</p>}
        </div>
      </div>
      {error && (
        <p className="rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-3 text-sm text-chrome-red-400">{error}</p>
      )}
      {children}
    </div>
  );
}
