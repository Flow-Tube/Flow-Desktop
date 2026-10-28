import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Clipboard,
  Download,
  Loader2,
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
} from "../../../lib/api/downloads";
import { copyText } from "../../../lib/clipboard";
import { getString } from "../../../lib/i18n/index";
import { useDownloadLogs } from "../../../lib/useDownloadLogs";
import { useDownloadStore } from "../../../store/useDownloadStore";
import { useUiStore } from "../../../store/useUiStore";
import { Button } from "../../ui/Button";
import { DOWNLOAD_SURFACE_SPRING } from "../surface";

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return getString("download_size_unknown");
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** The details view shares a `layoutId` with its dock card, so it grows out of the
 *  card and collapses back into it. */
function MorphFrame({ children, onClose, morphId }: { children: React.ReactNode; onClose: () => void; morphId: string }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] grid place-items-center p-5">
      <motion.div
        layoutId={morphId}
        layout
        transition={DOWNLOAD_SURFACE_SPRING}
        className="pointer-events-auto w-full max-w-[560px] overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface p-6"
      >
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: 0.05 }}>
          {children}
        </motion.div>
      </motion.div>
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

export function DownloadActivityDialog({
  id,
  onClose,
  morphId,
}: {
  id: string;
  onClose: () => void;
  morphId: string;
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
      <MorphFrame onClose={onClose} morphId={morphId}>
        <DialogHeader
          icon={<Download size={20} />}
          title={getString("download_activity_title")}
          subtitle={getString("download_activity_missing")}
          onClose={onClose}
        />
      </MorphFrame>
    );
  }

  return (
    <MorphFrame onClose={onClose} morphId={morphId}>
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
    </MorphFrame>
  );
}
