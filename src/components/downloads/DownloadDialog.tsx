import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileVideo2,
  Loader2,
  Music2,
  Pause,
  Play,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";

import {
  cancelDownload,
  pauseDownload,
  resumeDownload,
  retryDownload,
  type DownloadProgress,
} from "../../lib/api/downloads";
import { getString } from "../../lib/i18n/index";
import { copyText } from "../../lib/clipboard";
import { SETTINGS } from "../../lib/settings/schema";
import {
  describeMusicStream,
  displayDownloadResolution,
  useMusicDownloadDialog,
  useVideoDownloadDialog,
} from "../../lib/useDownloadDialog";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useDownloadLogs } from "../../lib/useDownloadLogs";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useDownloadStore } from "../../store/useDownloadStore";
import { useUiStore } from "../../store/useUiStore";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { TextInput } from "../ui/TextInput";
import { DOWNLOAD_SURFACE_SPRING, downloadSurfaceLayoutId } from "./surface";

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return getString("download_size_unknown");
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function DialogFrame({
  children,
  compact,
  onClose,
  morphId,
}: {
  children: React.ReactNode;
  compact: boolean;
  onClose: () => void;
  morphId?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const panelClassName = `pointer-events-auto w-full ${compact ? "max-w-lg" : "max-w-2xl"} rounded-2xl border border-chrome-neutral-800 bg-surface p-6`;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] grid place-items-center p-5">
      {morphId ? (
        // Morph surface: shares a `layoutId` with the dock card so the dialog
        // expands out of it and collapses back into it. `overflow-hidden` keeps the
        // corners clean while the box resizes (safe here — no overflowing menus).
        <motion.div
          layoutId={morphId}
          layout
          transition={DOWNLOAD_SURFACE_SPRING}
          className={`${panelClassName} overflow-hidden`}
        >
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: 0.05 }}>
            {children}
          </motion.div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 6 }}
          transition={DOWNLOAD_SURFACE_SPRING}
          className={panelClassName}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

function DialogHeader({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-200">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
        <p className="mt-1 text-sm text-chrome-neutral-400">{subtitle}</p>
      </div>
      <button
        type="button"
        aria-label={getString("close")}
        onClick={onClose}
        className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
      >
        <X size={18} />
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-chrome-neutral-400">
      <Loader2 className="h-5 w-5 animate-spin" />
      {getString("download_loading_formats")}
    </div>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-3 text-sm text-chrome-red-300">
      {message}
    </div>
  );
}

function progressPercent(progress: DownloadProgress | undefined): number | null {
  if (!progress?.totalBytes || progress.totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100));
}

function DownloadProgressPanel({
  progress,
  onCancel,
  onPause,
  onResume,
  onRetry,
}: {
  progress: DownloadProgress | undefined;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
}) {
  const status = progress?.status ?? "queued";
  const percent = progressPercent(progress);
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  const paused = status === "paused";
  const waiting = status === "waitingForNetwork";
  const statusLabel = status === "muxing"
    ? getString("download_muxing")
    : status === "completed"
      ? getString("download_complete")
      : status === "failed"
        ? getString("download_failed")
        : status === "cancelled"
          ? getString("download_cancelled")
          : paused
            ? getString("download_paused")
            : waiting
              ? getString("download_waiting_network")
              : status === "queued"
                ? getString("download_queued")
                : getString("download_downloading_tracks");

  return (
    <div className="mt-6 rounded-xl border border-chrome-neutral-800 bg-surface-container-low p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-300">
          {status === "completed" ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--color-primary)]" />
          ) : status === "failed" ? (
            <XCircle className="h-5 w-5 text-chrome-red-400" />
          ) : waiting ? (
            <WifiOff className="h-5 w-5" />
          ) : paused ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-chrome-neutral-100">{statusLabel}</div>
          <div className="mt-1 truncate font-mono text-xs text-chrome-neutral-500">
            {progress?.error
              ?? (progress?.totalBytes
                ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                : progress?.qualityLabel ?? getString("download_preparing"))}
          </div>
        </div>
        {status === "failed" ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <Play size={15} />
            {getString("download_retry")}
          </Button>
        ) : null}
        {!terminal ? (
          <div className="flex items-center gap-1">
            {status !== "muxing" ? (
              <Button variant="ghost" size="sm" onClick={paused ? onResume : onPause}>
                {paused ? <Play size={15} /> : <Pause size={15} />}
                {paused ? getString("download_resume") : getString("download_pause")}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {getString("download_cancel")}
            </Button>
          </div>
        ) : null}
      </div>
      {!terminal ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className={`h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ease-out ${percent == null ? "w-1/3 animate-pulse" : ""}`}
            style={percent == null ? undefined : { width: `${percent}%` }}
          />
        </div>
      ) : null}
      {progress?.error ? (
        <div className="mt-4 rounded-lg border border-chrome-neutral-800 bg-surface-container-high p-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("download_failure_reason")}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-chrome-red-300">
            {progress.error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function VideoDownloadDialog({
  compact,
  onClose,
}: {
  compact: boolean;
  onClose: () => void;
}) {
  const dialog = useDownloadStore((store) => store.dialog);
  const video = dialog?.kind === "video" ? dialog.video : null;
  const showToast = useUiStore((store) => store.showToast);
  const state = useVideoDownloadDialog(video);
  const thumbnail = useProxiedImageUrl(video?.thumbnailUrl);
  const visibleFormats = state.selected
    ? state.formats.filter((format) => format.container === state.selected?.container)
    : state.formats;
  const resolvedError = state.error === "download_no_adaptive_formats"
    ? getString("download_no_adaptive_formats")
    : state.error;

  // Starting hands the download off to the dock, keeping a single surface visible.
  const start = async () => {
    const result = await state.submit();
    if (!result) return;
    showToast({ variant: "success", message: getString("download_started") });
    onClose();
  };

  return (
    <DialogFrame compact={compact} onClose={onClose}>
      <DialogHeader
        icon={<FileVideo2 size={20} />}
        title={getString("download_video_title")}
        subtitle={getString("download_video_subtitle")}
        onClose={onClose}
      />
      {state.loading ? (
        <LoadingState />
      ) : (
        <div className="mt-6 space-y-5">
          <div className="flex items-center gap-4 rounded-xl border border-chrome-neutral-800 bg-surface-container-low p-3">
            <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-surface-container-high">
              {thumbnail ? (
                <img src={thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center text-chrome-neutral-500">
                  <FileVideo2 size={24} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-medium leading-5 text-chrome-neutral-100">
                {video?.title}
              </div>
              <div className="mt-1 truncate text-sm text-chrome-neutral-400">{video?.channelName}</div>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              {getString("download_file_name")}
            </label>
            <TextInput value={state.title} onChange={state.setTitle} className="h-10 w-full" />
          </div>

          {state.formats.length > 0 ? (
            <>
              {state.containers.length > 1 ? (
                <fieldset>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                    {getString("download_container")}
                  </legend>
                  <div className="flex gap-2">
                    {state.containers.map((container) => {
                      const selected = state.selected?.container === container;
                      return (
                        <button
                          key={container}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => state.selectContainer(container)}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ease-out ${
                            selected
                              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                              : "bg-surface-container-high text-chrome-neutral-300 hover:bg-surface-container-highest"
                          }`}
                        >
                          {container.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                  {getString("download_resolution")}
                </label>
                <Select
                  value={state.selectedId}
                  onChange={state.setSelectedId}
                  className="w-full"
                  options={visibleFormats.map((format) => ({
                    value: format.formatId,
                    label: `${displayDownloadResolution(format)} - ${formatBytes(format.estimatedSizeBytes)}`,
                  }))}
                />
              </div>

              {state.selected ? (
                <div className="grid grid-cols-3 divide-x divide-chrome-neutral-800 rounded-xl border border-chrome-neutral-800 bg-surface-container-low">
                  <div className="px-4 py-3">
                    <div className="text-xs text-chrome-neutral-500">{getString("download_video_codec")}</div>
                    <div className="mt-1 font-mono text-sm text-chrome-neutral-100">{state.selected.videoCodec}</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-xs text-chrome-neutral-500">{getString("download_audio_codec")}</div>
                    <div className="mt-1 font-mono text-sm text-chrome-neutral-100">{state.selected.audioCodec}</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-xs text-chrome-neutral-500">{getString("download_frame_rate")}</div>
                    <div className="mt-1 font-mono text-sm text-chrome-neutral-100">
                      {state.selected.fps ? `${state.selected.fps} FPS` : "—"}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {resolvedError ? (
            <p role="alert" className="text-sm text-chrome-neutral-400">{resolvedError}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>{getString("cancel")}</Button>
            <Button onClick={() => void start()} disabled={!state.selected || state.starting}>
              {state.starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download size={16} />}
              {getString("download")}
            </Button>
          </div>
        </div>
      )}
    </DialogFrame>
  );
}

function DownloadActivityDialog({
  id,
  compact,
  onClose,
  morphId,
}: {
  id: string;
  compact: boolean;
  onClose: () => void;
  morphId?: string;
}) {
  const progress = useDownloadStore((state) => state.active[id]);
  const showToast = useUiStore((state) => state.showToast);
  const logs = useDownloadLogs(id, progress?.status);

  const copyLogs = async () => {
    const text = [
      `Flow Desktop download: ${progress?.title ?? id}`,
      `Status: ${progress?.status ?? "unknown"}`,
      `File: ${progress?.filePath ?? "unknown"}`,
      progress?.error ? `Failure: ${progress.error}` : "",
      "",
      ...logs,
    ].filter(Boolean).join("\n");
    if (await copyText(text)) {
      showToast({ variant: "success", message: getString("download_logs_copied") });
    } else {
      showToast({ variant: "error", message: getString("download_logs_copy_failed") });
    }
  };

  if (!progress) {
    return (
      <DialogFrame compact={compact} onClose={onClose} morphId={morphId}>
        <DialogHeader
          icon={<Download size={20} />}
          title={getString("download_activity_title")}
          subtitle={getString("download_activity_missing")}
          onClose={onClose}
        />
      </DialogFrame>
    );
  }

  return (
    <DialogFrame compact={compact} onClose={onClose} morphId={morphId}>
      <DialogHeader
        icon={<Download size={20} />}
        title={progress.title}
        subtitle={progress.qualityLabel}
        onClose={onClose}
      />
      <DownloadProgressPanel
        progress={progress}
        onCancel={() => void cancelDownload(id)}
        onPause={() => void pauseDownload(id)}
        onResume={() => void resumeDownload(id)}
        onRetry={() => void retryDownload(id)}
      />
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("download_failure_logs")}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void copyLogs()}>
            <Clipboard size={14} />
            {getString("download_copy_logs")}
          </Button>
        </div>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-chrome-neutral-800 bg-surface-container-low p-3">
          {logs.length > 0 ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-chrome-neutral-300">
              {logs.join("\n")}
            </pre>
          ) : (
            <p className="text-sm text-chrome-neutral-500">{getString("download_no_logs")}</p>
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>{getString("close")}</Button>
      </div>
    </DialogFrame>
  );
}

function MusicDownloadDialog({
  compact,
  onClose,
}: {
  compact: boolean;
  onClose: () => void;
}) {
  const dialog = useDownloadStore((state) => state.dialog);
  const track = dialog?.kind === "music" ? dialog.track : null;
  const showToast = useUiStore((state) => state.showToast);
  const state = useMusicDownloadDialog(track);

  const start = async () => {
    const result = await state.submit();
    if (!result) return;
    showToast({ variant: "success", message: getString("download_started") });
    onClose();
  };

  return (
    <DialogFrame compact={compact} onClose={onClose}>
      <DialogHeader
        icon={<Music2 size={20} />}
        title={getString("download_music_title")}
        subtitle={getString("download_music_subtitle")}
        onClose={onClose}
      />
      {state.loading ? (
        <LoadingState />
      ) : (
        <div className="mt-6 space-y-5">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              {getString("download_file_name")}
            </label>
            <TextInput value={state.title} onChange={state.setTitle} className="h-10 w-full" />
          </div>
          {state.stream ? (
            <div className="rounded-xl border border-chrome-neutral-800 bg-surface-container-low px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                {getString("download_audio_format")}
              </div>
              <div className="mt-2 font-mono text-sm text-chrome-neutral-100">{describeMusicStream(state.stream)}</div>
              {!compact ? (
                <p className="mt-2 text-sm text-chrome-neutral-400">{getString("download_original_container_note")}</p>
              ) : null}
            </div>
          ) : null}
          <ErrorMessage message={state.error} />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>{getString("cancel")}</Button>
            <Button onClick={() => void start()} disabled={!state.stream || state.starting}>
              {state.starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download size={16} />}
              {getString("download")}
            </Button>
          </div>
        </div>
      )}
    </DialogFrame>
  );
}

export function DownloadDialog() {
  const dialog = useDownloadStore((state) => state.dialog);
  const close = useDownloadStore((state) => state.closeDialog);
  const style = useAppSettingsStore(
    (state) => state.values[SETTINGS.DOWNLOAD_DIALOG_STYLE] ?? "FULL",
  );
  const compact = style === "COMPACT";

  return (
    <>
      <AnimatePresence>
        {dialog ? (
          <motion.div
            key="download-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onMouseDown={close}
            className="fixed inset-0 z-[115] bg-chrome-black/70"
          />
        ) : null}
      </AnimatePresence>

      {/* Format pickers fade in/out; they have no dock counterpart to morph from. */}
      <AnimatePresence>
        {dialog?.kind === "video" ? (
          <VideoDownloadDialog key="download-video" compact={compact} onClose={close} />
        ) : dialog?.kind === "music" ? (
          <MusicDownloadDialog key="download-music" compact={compact} onClose={close} />
        ) : null}
      </AnimatePresence>

      {/* The activity view morphs to/from its dock card via the shared layoutId. */}
      {dialog?.kind === "activity" ? (
        <DownloadActivityDialog
          id={dialog.id}
          compact={compact}
          onClose={close}
          morphId={downloadSurfaceLayoutId(dialog.id)}
        />
      ) : null}
    </>
  );
}
