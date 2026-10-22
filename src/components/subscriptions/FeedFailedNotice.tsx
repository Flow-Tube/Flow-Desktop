import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";

const NAMES_SHOWN = 4;

export interface FeedFailedNoticeProps {
  /** Names of the channels whose uploads could not be read. */
  names: string[];
  onRetry: () => void;
  retrying?: boolean;
}

/** Says which channels are missing from the feed, instead of showing them as having nothing new. */
export function FeedFailedNotice({ names, onRetry, retrying = false }: FeedFailedNoticeProps) {
  if (names.length === 0) return null;
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  const list =
    names.length > NAMES_SHOWN ? getString("subscriptions_failed_more", shown, names.length - NAMES_SHOWN) : shown;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-chrome-neutral-400" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-chrome-neutral-100">{getString("subscriptions_failed_title")}</p>
          <p className="mt-0.5 text-sm text-chrome-neutral-400">{getString("subscriptions_failed_body", list)}</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying} className="shrink-0">
        <RefreshCw size={14} className={retrying ? "animate-spin" : undefined} />
        {getString("subscriptions_failed_retry")}
      </Button>
    </div>
  );
}
