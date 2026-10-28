import { AlertTriangle, RefreshCcw, ArrowLeft } from "lucide-react";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";
import type { WatchErrorStateProps } from "./types";

export function WatchErrorState({ message, onRetryWithProxy, onGoBack }: WatchErrorStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{getString("watch_error_title")}</h2>
        <p className="mt-2 select-text text-sm leading-relaxed text-chrome-neutral-400">{message}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {onRetryWithProxy && (
            <Button variant="primary" onClick={onRetryWithProxy}>
              <RefreshCcw size={18} />
              {getString("watch_retry_proxy")}
            </Button>
          )}
          <Button variant="tonal" onClick={onGoBack}>
            <ArrowLeft size={18} />
            {getString("watch_go_back")}
          </Button>
        </div>
      </div>
    </div>
  );
}
