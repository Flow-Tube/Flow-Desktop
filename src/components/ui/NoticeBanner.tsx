import type { ReactNode } from "react";

import { Button } from "./Button";

interface NoticeBannerProps {
  icon: ReactNode;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** A one-line notice above a page's content, with an optional action at its end. */
export function NoticeBanner({ icon, message, actionLabel, onAction }: NoticeBannerProps) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low px-4 py-3">
      <span className="shrink-0 text-chrome-neutral-400">{icon}</span>
      <p className="min-w-0 flex-1 text-sm text-chrome-neutral-200">{message}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
