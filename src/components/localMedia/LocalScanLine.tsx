import { Loader2 } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import { Button } from "../ui/Button";

/** Says what the scan is doing, and lets it be stopped. Quiet when there is nothing to say. */
export function LocalScanLine() {
  const scan = useLocalMediaStore((s) => s.scan);
  const cancelScan = useLocalMediaStore((s) => s.cancelScan);

  if (scan.running) {
    return (
      <div className="flex items-center gap-2 text-sm text-chrome-neutral-400" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="tabular-nums">
          {scan.total > 0
            ? getString("local_media_scanning_progress", scan.done, scan.total)
            : getString("local_media_scanning")}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void cancelScan()}>
          {getString("local_media_scan_stop")}
        </Button>
      </div>
    );
  }
  if (scan.failed || scan.truncated) {
    return (
      <p className="text-sm text-chrome-neutral-400" role="status">
        {getString(scan.failed ? "local_media_scan_failed" : "local_media_truncated")}
      </p>
    );
  }
  return null;
}
