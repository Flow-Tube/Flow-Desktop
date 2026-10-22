import { useState } from "react";
import { AlertTriangle, RotateCcw, Copy, ExternalLink, Check } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import type { PlayerErrorInfo } from "../../lib/playerError";
import { UpcomingCountdown } from "./UpcomingCountdown";

export interface PlayerErrorStateProps {
  error: PlayerErrorInfo;
  onRetry?: () => void;
  onCopyLogs?: () => Promise<boolean> | boolean | void;
  onOpenInBrowser?: () => void;
  variant?: "overlay" | "compact";
  className?: string;
}

const ACTION =
  "inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition-colors duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-60 disabled:pointer-events-none";
const ACTION_PRIMARY = `${ACTION} border-transparent bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90`;
const ACTION_QUIET = `${ACTION} border-chrome-neutral-700 bg-transparent text-chrome-neutral-200 hover:bg-surface-container-high`;

export function PlayerErrorState({
  error,
  onRetry,
  onCopyLogs,
  onOpenInBrowser,
  variant = "overlay",
  className = "",
}: PlayerErrorStateProps) {
  const [copied, setCopied] = useState(false);

  const showRetry = error.retryable && Boolean(onRetry);
  const showOpen = error.canOpenInBrowser && Boolean(onOpenInBrowser);
  const showCopy = Boolean(onCopyLogs);

  const handleCopy = async () => {
    if (!onCopyLogs) return;
    const result = await onCopyLogs();
    if (result === false) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const compact = variant === "compact";
  const btnSize = compact ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  const iconSize = compact ? 14 : 16;

  const actions = (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "justify-center"}`}>
      {showRetry && (
        <button type="button" onClick={onRetry} className={`${ACTION_PRIMARY} ${btnSize}`}>
          <RotateCcw size={iconSize} />
          {getString("player_error_retry")}
        </button>
      )}
      {showCopy && (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`${ACTION_QUIET} ${btnSize}`}
        >
          {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
          {copied ? getString("player_error_logs_copied") : getString("player_error_copy_logs")}
        </button>
      )}
      {showOpen && (
        <button type="button" onClick={onOpenInBrowser} className={`${ACTION_QUIET} ${btnSize}`}>
          <ExternalLink size={iconSize} />
          {getString("player_error_open_browser")}
        </button>
      )}
    </div>
  );

  if (compact) {
    return (
      <div
        className={`flex items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-high px-4 py-3 ${className}`}
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400">
          <AlertTriangle className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-chrome-neutral-100">{error.title}</div>
          <div className="truncate text-xs text-chrome-neutral-400">{error.hint}</div>
        </div>
        <div className="shrink-0">{actions}</div>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-md text-center ${className}`}>
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-bold tracking-tight text-chrome-neutral-100">{error.title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-chrome-neutral-400">
        {error.hint}
      </p>
      {error.startsAtMs != null && (
        <UpcomingCountdown startsAtMs={error.startsAtMs} onDue={onRetry} />
      )}
      <div className="mt-5">{actions}</div>
    </div>
  );
}
