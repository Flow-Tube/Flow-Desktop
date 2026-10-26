import { useEffect, useRef } from "react";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import {
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  X,
  XCircle,
  WifiOff,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import {
  cancelDownload,
  discardDownload,
  pauseDownload,
  restoreDownloads,
  resumeDownload,
  type DownloadProgress,
  type DownloadStatus,
} from "../../lib/api/downloads";
import { isTauriEnv } from "../../lib/api/env";
import { useDownloadConcurrency } from "../../lib/useDownloadConcurrency";
import { getString } from "../../lib/i18n/index";
import { useDownloadStore } from "../../store/useDownloadStore";
import { useDownloadsLibraryStore } from "../../store/useDownloadsLibraryStore";
import { useDownloadCollectionsLibraryStore } from "../../store/useDownloadCollectionsLibraryStore";
import { useCollectionDownloadStore } from "../../store/useCollectionDownloadStore";
import { DOWNLOAD_SURFACE_SPRING, downloadSurfaceLayoutId } from "./surface";

/** A finished (successful) download slides off to the left after this delay. */
const AUTO_DISMISS_MS = 5000;

const RUNNING_STATUSES = new Set<DownloadStatus>([
  "queued",
  "downloading",
  "paused",
  "waitingForNetwork",
  "muxing",
]);

/** Slide-and-fade off the left edge of the dock. */
const DOCK_EXIT = { opacity: 0, x: -48 };
const DOCK_EXIT_TRANSITION: Transition = { duration: 0.3, ease: "easeIn" };

function isRunning(item: DownloadProgress): boolean {
  return RUNNING_STATUSES.has(item.status);
}

/** Slides a card away `AUTO_DISMISS_MS` after it settles into a finished state.
 *  The timer is owned by the card, so a re-mount (e.g. a dialog opening and
 *  closing) simply restarts the countdown instead of losing it. */
function useAutoDismiss(finished: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (!finished) return;
    const handle = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [finished]);
}

function progressPercent(item: DownloadProgress): number | null {
  if (!item.totalBytes || item.totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, (item.downloadedBytes / item.totalBytes) * 100));
}

function DockCard({
  item,
  onOpen,
  onDismiss,
}: {
  item: DownloadProgress;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const percent = progressPercent(item);
  const paused = item.status === "paused";
  const waiting = item.status === "waitingForNetwork";
  const running = item.status === "queued"
    || item.status === "downloading"
    || paused
    || waiting
    || item.status === "muxing";
  const failed = item.status === "failed";
  const detail = failed
    ? item.error
    : item.status === "completed"
      ? getString("download_complete")
      : item.status === "muxing"
        ? getString("download_muxing")
        : waiting
          ? getString("download_waiting_network")
          : paused
            ? getString("download_paused")
            : item.qualityLabel;

  const done = item.status === "completed" || item.status === "cancelled";
  useAutoDismiss(done, onDismiss);

  return (
    <motion.div
      layoutId={downloadSurfaceLayoutId(item.id)}
      layout
      initial={false}
      exit={{ ...DOCK_EXIT, transition: DOCK_EXIT_TRANSITION }}
      transition={DOWNLOAD_SURFACE_SPRING}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      className="cursor-pointer rounded-2xl border border-chrome-neutral-800 bg-surface-container-high p-4 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-chrome-neutral-300">
          {waiting ? (
            <WifiOff className="h-4 w-4" />
          ) : running && !paused ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : paused ? (
            <Pause className="h-4 w-4" />
          ) : failed ? (
            <XCircle className="h-4 w-4 text-chrome-red-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[var(--color-primary)]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-chrome-neutral-100">{item.title}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-chrome-neutral-400">{detail}</div>
        </div>
        <div className="flex items-center gap-1">
          {running && item.status !== "muxing" ? (
            <button
              type="button"
              aria-label={paused ? getString("download_resume") : getString("download_pause")}
              onClick={(event) => {
                event.stopPropagation();
                void (paused ? resumeDownload(item.id) : pauseDownload(item.id));
              }}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-low hover:text-chrome-neutral-100"
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={running ? getString("download_cancel") : getString("close")}
            onClick={(event) => {
              event.stopPropagation();
              if (running) void cancelDownload(item.id);
              else {
                if (failed) void discardDownload(item.id);
                onDismiss();
              }
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-low hover:text-chrome-neutral-100"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {running ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-low">
          <div
            className={`h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ${percent == null ? "w-1/3 animate-pulse" : ""}`}
            style={percent == null ? undefined : { width: `${percent}%` }}
          />
        </div>
      ) : null}
    </motion.div>
  );
}

type GroupState = "running" | "paused" | "done" | "failed";

/** Aggregate card for a batch of downloads — an ad-hoc queue of standalone videos
 *  or a playlist/album run. Shows a `X of N` counter and the item in flight. */
function GroupDockCard({
  title,
  detail,
  subDetail,
  fraction,
  state,
  onTogglePause,
  onCancelAll,
  onDismiss,
}: {
  title: string;
  detail?: string;
  subDetail?: string;
  fraction: number | null;
  state: GroupState;
  onTogglePause?: () => void;
  onCancelAll?: () => void;
  onDismiss: () => void;
}) {
  const running = state === "running" || state === "paused";
  const paused = state === "paused";
  useAutoDismiss(state === "done", onDismiss);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ ...DOCK_EXIT, transition: DOCK_EXIT_TRANSITION }}
      transition={DOWNLOAD_SURFACE_SPRING}
      className="rounded-2xl border border-chrome-neutral-800 bg-surface-container-high p-4"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-chrome-neutral-300">
          {state === "done" ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--color-primary)]" />
          ) : state === "failed" ? (
            <XCircle className="h-4 w-4 text-chrome-red-400" />
          ) : paused ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-chrome-neutral-100">{title}</div>
          {detail ? (
            <div className="mt-0.5 truncate text-xs text-chrome-neutral-400">{detail}</div>
          ) : null}
          {subDetail ? (
            <div className="mt-0.5 truncate text-xs text-chrome-neutral-500">{subDetail}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {running && onTogglePause ? (
            <button
              type="button"
              aria-label={paused ? getString("download_queue_resume_all") : getString("download_queue_pause_all")}
              onClick={onTogglePause}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-low hover:text-chrome-neutral-100"
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
          ) : null}
          {running && onCancelAll ? (
            <button
              type="button"
              aria-label={getString("download_queue_cancel_all")}
              onClick={onCancelAll}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-low hover:text-chrome-neutral-100"
            >
              <X size={15} />
            </button>
          ) : !running ? (
            <button
              type="button"
              aria-label={getString("close")}
              onClick={onDismiss}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-low hover:text-chrome-neutral-100"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </div>
      {running ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-low">
          <div
            className={`h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ${fraction == null ? "w-1/3 animate-pulse" : ""}`}
            style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      ) : null}
    </motion.div>
  );
}

export function DownloadActivity() {
  const active = useDownloadStore((state) => state.active);
  const dialog = useDownloadStore((state) => state.dialog);
  const updateProgress = useDownloadStore((state) => state.updateProgress);
  const dismissProgress = useDownloadStore((state) => state.dismissProgress);
  const openActivity = useDownloadStore((state) => state.openActivity);
  const runs = useCollectionDownloadStore((state) => state.runs);
  const dismissRun = useCollectionDownloadStore((state) => state.dismissRun);
  useDownloadConcurrency();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void isTauriEnv().then(async (tauri) => {
      if (!tauri) return;
      const stop = await listen<DownloadProgress>("download-progress", (event) => {
        updateProgress(event.payload);
        useCollectionDownloadStore.getState().handleProgress(event.payload);
        if (event.payload.status === "completed") {
          void useDownloadsLibraryStore.getState().load();
          if (event.payload.collectionDbId != null) {
            void useDownloadCollectionsLibraryStore.getState().load();
          }
        }
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      // Downloads a previous run left unfinished resume now, and every unfinished one
      // shows in the dock even if this window opened after it started.
      const unfinished = await restoreDownloads().catch(() => []);
      for (const progress of unfinished) updateProgress(progress);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [updateProgress]);

  const collectionRuns = Object.values(runs);
  const solo = Object.values(active)
    .filter((item) => item.collectionDbId == null)
    .reverse();

  const runCards = collectionRuns.map((run) => {
    const items = Object.values(active).filter((item) => item.collectionDbId === run.dbId);
    const current = items.find((item) => item.status === "downloading")
      ?? items.find((item) => isRunning(item));
    let progressSum = run.completed + run.failed;
    for (const item of items) {
      if (isRunning(item)) {
        const percent = progressPercent(item);
        if (percent != null) progressSum += percent / 100;
      }
    }
    const fraction = run.total > 0 ? Math.min(1, progressSum / run.total) : null;
    const state: GroupState = run.active ? "running" : run.failed > 0 ? "failed" : "done";
    const detail = state === "failed"
      ? getString("download_queue_failed", run.completed, run.total, run.failed)
      : state === "done"
        ? getString("download_queue_complete", run.completed)
        : getString("download_queue_progress", run.completed, run.total);
    return { run, current, fraction, state, detail };
  });

  let soloGroup: {
    title: string;
    detail?: string;
    fraction: number | null;
    state: GroupState;
    ids: string[];
    runningItems: DownloadProgress[];
  } | null = null;

  if (solo.length >= 2) {
    const completed = solo.filter((item) => item.status === "completed").length;
    const failed = solo.filter((item) => item.status === "failed").length;
    const total = solo.length;
    const runningItems = solo.filter(isRunning);
    const current = runningItems.find((item) => item.status === "downloading") ?? runningItems[0];
    let progressSum = 0;
    for (const item of solo) {
      if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
        progressSum += 1;
      } else {
        const percent = progressPercent(item);
        if (percent != null) progressSum += percent / 100;
      }
    }
    const allTerminal = runningItems.length === 0;
    const state: GroupState = allTerminal
      ? failed > 0 ? "failed" : "done"
      : runningItems.every((item) => item.status === "paused") ? "paused" : "running";
    const title = allTerminal
      ? failed > 0
        ? getString("download_queue_failed", completed, total, failed)
        : getString("download_queue_complete", completed)
      : getString("download_queue_progress", completed, total);
    soloGroup = {
      title,
      detail: allTerminal ? undefined : current?.title,
      fraction: total > 0 ? Math.min(1, progressSum / total) : null,
      state,
      ids: solo.map((item) => item.id),
      runningItems,
    };
  }

  if (dialog) return null;

  const single = solo.length === 1 ? solo[0] : undefined;

  const toggleGroupPause = (group: NonNullable<typeof soloGroup>) => {
    const resume = group.state === "paused";
    for (const item of group.runningItems) {
      if (resume) {
        if (item.status === "paused") void resumeDownload(item.id);
      } else if (item.status !== "muxing" && item.status !== "paused") {
        void pauseDownload(item.id);
      }
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-[120] flex max-h-[70vh] w-[380px] max-w-[calc(100vw-3rem)] flex-col gap-2 overflow-x-hidden overflow-y-auto">
      <AnimatePresence initial={false}>
        {runCards.map(({ run, current, fraction, state, detail }) => (
          <GroupDockCard
            key={`run-${run.dbId}`}
            title={run.title}
            detail={detail}
            subDetail={state === "running" ? current?.title : undefined}
            fraction={fraction}
            state={state}
            onDismiss={() => dismissRun(run.dbId)}
          />
        ))}
        {soloGroup ? (
          <GroupDockCard
            key="queue"
            title={soloGroup.title}
            detail={soloGroup.detail}
            fraction={soloGroup.fraction}
            state={soloGroup.state}
            onTogglePause={() => toggleGroupPause(soloGroup!)}
            onCancelAll={() => soloGroup!.runningItems.forEach((item) => void cancelDownload(item.id))}
            onDismiss={() => {
              for (const item of solo) {
                if (item.status === "failed") void discardDownload(item.id);
                dismissProgress(item.id);
              }
            }}
          />
        ) : single ? (
          <DockCard
            key={`solo-${single.id}`}
            item={single}
            onOpen={() => openActivity(single.id)}
            onDismiss={() => dismissProgress(single.id)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
