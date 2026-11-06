import { useMemo } from "react";
import { HardDrive } from "lucide-react";
import type { DownloadRecord } from "../../lib/api/downloads";
import { formatBytes } from "../../lib/downloadOptions";
import { downloadedBytes } from "../../lib/downloadsSort";
import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useDownloadFreeSpace } from "../../lib/useDownloadFreeSpace";
import { useBoolPref, usePreference } from "../../lib/usePreference";

/** The space downloads take and what is left on the volume they are saved to. */
export function DownloadsStorageSummary({ records }: { records: DownloadRecord[] }) {
  const [enabled] = useBoolPref(SETTINGS.DOWNLOADS_STORAGE_CARD, true);
  const [videoFolder] = usePreference(SETTINGS.DOWNLOAD_LOCATION, "");
  const free = useDownloadFreeSpace(videoFolder || null, records.length);
  const bytes = useMemo(() => downloadedBytes(records), [records]);
  if (!enabled) return null;

  const used = formatBytes(bytes.video + bytes.music) ?? "0 MB";
  const parts = [
    getString("downloads_storage_used", used),
    bytes.video > 0 && bytes.music > 0 ? getString("downloads_storage_videos", formatBytes(bytes.video) ?? "") : null,
    bytes.video > 0 && bytes.music > 0 ? getString("downloads_storage_music", formatBytes(bytes.music) ?? "") : null,
    free !== null ? getString("downloads_storage_free", formatBytes(free) ?? "0 MB") : null,
  ].filter(Boolean);

  return (
    <div className="ms-auto flex min-w-0 items-center gap-2 text-sm tabular-nums text-chrome-neutral-400">
      <HardDrive size={16} className="shrink-0" />
      <span className="truncate">{parts.join(" • ")}</span>
    </div>
  );
}
