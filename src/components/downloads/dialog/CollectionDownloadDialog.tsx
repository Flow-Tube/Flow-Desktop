import { CheckCircle2, Disc3, ListVideo, Loader2 } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { pickFolder } from "../../../lib/dialogs";
import { formatBytes, formatDuration } from "../../../lib/downloadOptions";
import { SETTINGS } from "../../../lib/settings/schema";
import { useCollectionDownloadSheet, type CollectionRequest } from "../../../lib/useCollectionDownloadSheet";
import { useAppSettingsStore } from "../../../store/useAppSettingsStore";
import { DialogFooter, DialogFrame, DialogHeader } from "./DownloadDialogShell";

export function CollectionDownloadDialog({ request, onClose }: { request: CollectionRequest; onClose: () => void }) {
  const state = useCollectionDownloadSheet(request);
  const album = request.kind === "album";
  const defaultFolder = useAppSettingsStore((store) =>
    album
      ? store.values[SETTINGS.MUSIC_DOWNLOAD_LOCATION] || getString("settings_system_default_music")
      : store.values[SETTINGS.DOWNLOAD_LOCATION] || getString("settings_system_default_videos"),
  );
  const { meta } = request;
  const folderName = album && meta.author ? `${meta.author} - ${meta.title}` : meta.title;
  const count = getString(album ? "download_collection_songs" : "download_collection_videos", state.items.length);
  const summary = [
    count,
    state.durationSeconds > 0 ? formatDuration(state.durationSeconds) : null,
    album && formatBytes(state.sizes[state.quality]) ? `≈ ${formatBytes(state.sizes[state.quality])}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const subtitle = [meta.author, getString(album ? "download_album_label" : "download_playlist_label"), meta.year]
    .filter(Boolean)
    .join(" · ");

  const start = () => {
    state.submit();
    onClose();
  };
  const changeFolder = async () => {
    const path = await pickFolder(getString(album ? "settings_music_download_folder" : "settings_video_download_folder"));
    if (path) state.setFolder(path);
  };

  return (
    <DialogFrame onClose={onClose} width="max-w-[460px]">
      <DialogHeader
        artwork={meta.thumbnailUrl}
        shape={album ? "square" : "landscape"}
        fallbackIcon={album ? <Disc3 size={22} /> : <ListVideo size={22} />}
        title={meta.title}
        subtitle={subtitle}
        meta={state.loading ? null : summary}
        onClose={onClose}
      />
      <div className="flex flex-col gap-3 px-5 pb-4">
        {state.loading ? (
          <div className="flex items-center gap-2 text-sm text-chrome-neutral-400">
            <Loader2 size={15} className="animate-spin" />
            {getString("download_collection_loading")}
          </div>
        ) : null}
        {album && !state.loading ? (
          <div role="radiogroup" aria-label={getString("download_quality")} className="grid gap-2 sm:grid-cols-2">
            {(["High", "Low"] as const).map((quality) => (
              <button
                key={quality}
                type="button"
                role="radio"
                aria-checked={state.quality === quality}
                onClick={() => state.setQuality(quality)}
                className={`grid gap-0.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors duration-200 ease-out ${
                  state.quality === quality
                    ? "border-chrome-neutral-500 bg-surface-container"
                    : "border-chrome-neutral-800 hover:bg-surface-container-low"
                }`}
              >
                <span className="font-medium text-chrome-neutral-100">
                  {getString(quality === "High" ? "download_quality_high" : "download_quality_data_saver")}
                </span>
                <span className="font-mono text-xs text-chrome-neutral-400">
                  AAC {quality === "High" ? 128 : 48} kbps
                  {formatBytes(state.sizes[quality]) ? ` · ≈ ${formatBytes(state.sizes[quality])}` : ""}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {state.saved > 0 ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-chrome-neutral-400">
            <CheckCircle2 size={14} />
            {getString("download_collection_skipped", state.saved)}
          </p>
        ) : null}
        {state.errorMessage ? (
          <p role="alert" className="text-sm text-chrome-red-300">{state.errorMessage}</p>
        ) : null}
      </div>
      <DialogFooter
        fileName={folderName}
        folder={state.folder ?? defaultFolder}
        onChangeFolder={() => void changeFolder()}
        primaryLabel={getString("download_collection_button", state.remaining)}
        starting={false}
        disabled={state.loading || state.remaining === 0}
        onCancel={onClose}
        onSubmit={start}
      />
    </DialogFrame>
  );
}
