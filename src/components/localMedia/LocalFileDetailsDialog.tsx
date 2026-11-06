import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import { formatBytes, formatDuration } from "../../lib/downloadOptions";
import { getString } from "../../lib/i18n/index";

/** The rows a file has anything to say for, in reading order. */
export function localFileDetails(file: LocalMediaFile): { label: string; value: string; technical?: boolean }[] {
  const rows: { label: string; value: string | null | false; technical?: boolean }[] = [
    { label: getString("local_detail_title"), value: file.title },
    { label: getString("local_detail_file"), value: file.fileName },
    { label: getString("local_detail_folder"), value: file.folderPath },
    { label: getString("local_detail_artist"), value: file.artist },
    { label: getString("local_detail_album"), value: file.album },
    { label: getString("local_detail_length"), value: file.durationMs > 0 && formatDuration(file.durationMs / 1000) },
    { label: getString("local_detail_size"), value: formatBytes(file.sizeBytes) },
    {
      label: getString("local_detail_resolution"),
      value: file.width > 0 && file.height > 0 && getString("local_detail_resolution_value", file.width, file.height),
    },
    {
      label: getString("local_detail_frame_rate"),
      value: file.frameRate !== null && getString("local_detail_fps", Number(file.frameRate.toFixed(2))),
    },
    { label: getString("local_detail_video_codec"), value: file.videoCodec, technical: true },
    { label: getString("local_detail_audio_codec"), value: file.audioCodec, technical: true },
    {
      label: getString("local_detail_bitrate"),
      value: file.bitrateKbps !== null && getString("local_detail_kbps", file.bitrateKbps),
    },
    {
      label: getString("local_detail_added"),
      value: file.addedMs > 0 && new Date(file.addedMs).toLocaleDateString(),
    },
  ];
  return rows.flatMap((row) => (row.value ? [{ label: row.label, value: row.value, technical: row.technical }] : []));
}

export function LocalFileDetailsDialog({ file, onClose }: { file: LocalMediaFile; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Stopped on the way down, so the player's shortcuts behind never see the key.
      event.stopPropagation();
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={getString("local_menu_details")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-base font-medium text-chrome-neutral-100">{getString("local_menu_details")}</h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={getString("local_details_close")}
            className="rounded-full p-1.5 text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={18} />
          </button>
        </div>
        <dl className="flex-1 overflow-y-auto px-5 pb-5">
          {localFileDetails(file).map((row) => (
            <div key={row.label} className="flex gap-4 border-t border-chrome-neutral-800/50 py-2 text-sm first:border-t-0">
              <dt className="w-28 shrink-0 text-chrome-neutral-400">{row.label}</dt>
              <dd className={`min-w-0 flex-1 select-text break-words text-chrome-neutral-100 ${row.technical ? "font-mono" : ""}`}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
