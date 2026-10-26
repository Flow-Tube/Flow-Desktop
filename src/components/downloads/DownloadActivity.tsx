import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Disc3,
  Film,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Tag,
  WifiOff,
  X,
} from "lucide-react";

import {
  cancelDownload,
  discardDownload,
  pauseDownload,
  resumeDownload,
  retryDownload,
  type DownloadProgress,
  type DownloadStatus,
} from "../../lib/api/downloads";
import { formatBytes, formatSpeed, formatTimeLeft } from "../../lib/downloadOptions";
import { getString } from "../../lib/i18n/index";
import { useDownloadConcurrency } from "../../lib/useDownloadConcurrency";
import { useDownloadEvents } from "../../lib/useDownloadEvents";
import { useDownloadItemActions, useDownloadItemArtwork } from "../../lib/useDownloadItem";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useCollectionDownloadStore, type CollectionRun } from "../../store/useCollectionDownloadStore";
import { useDownloadStore } from "../../store/useDownloadStore";
import { DOWNLOAD_SURFACE_SPRING, downloadSurfaceLayoutId } from "./surface";

/** A finished card slides away after this long, unless the pointer is on it. */
const AUTO_DISMISS_MS = 6000;
/** Rows a batch card lists before summing up the rest. */
const GROUP_ROWS = 4;

const RUNNING_STATUSES = new Set<DownloadStatus>(["queued", "downloading", "paused", "waitingForNetwork", "muxing"]);

const DOCK_EXIT = { opacity: 0, x: -48 };
const DOCK_EXIT_TRANSITION: Transition = { duration: 0.3, ease: "easeIn" };

const isRunning = (item: DownloadProgress) => RUNNING_STATUSES.has(item.status);

function progressFraction(item: DownloadProgress): number | null {
  if (!item.totalBytes || item.totalBytes <= 0) return null;
  return Math.max(0, Math.min(1, item.downloadedBytes / item.totalBytes));
}

/** Slides a finished card away after a while; the timer waits while it is hovered. */
function useAutoDismiss(finished: boolean, hovered: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (!finished || hovered) return;
    const handle = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [finished, hovered]);
}

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-3, -1).join(" › ");
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100"
    >
      {children}
    </button>
  );
}

function TextAction({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors duration-200 ease-out ${
        primary
          ? "bg-surface-container-highest text-chrome-neutral-100 hover:bg-surface-container-low"
          : "text-chrome-neutral-300 hover:bg-surface-container-highest"
      }`}
    >
      {children}
    </button>
  );
}

function statusBadge(status: DownloadStatus): ReactNode {
  switch (status) {
    case "muxing":
      return <Tag size={14} />;
    case "completed":
      return <Check size={14} />;
    case "failed":
      return <AlertCircle size={14} />;
    case "waitingForNetwork":
      return <WifiOff size={14} />;
    case "paused":
      return <Pause size={14} />;
    default:
      return null;
  }
}

/** The item's thumbnail or cover, with a small badge for states without a percent. */
function DockArtwork({ item, size }: { item: DownloadProgress; size: "card" | "row" }) {
  const artwork = useProxiedImageUrl(useDownloadItemArtwork(item));
  const [broken, setBroken] = useState(false);
  const square = item.mediaKind === "music";
  const frame =
    size === "card"
      ? square ? "w-[54px] aspect-square rounded-lg" : "w-24 aspect-video rounded-lg"
      : square ? "w-8 aspect-square rounded-md" : "w-14 aspect-video rounded-md";
  const badge = size === "card" ? statusBadge(item.status) : null;
  return (
    <div className={`relative shrink-0 overflow-hidden bg-surface-container-highest ${frame}`}>
      {artwork && !broken ? (
        <img src={artwork} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <div className="grid h-full w-full place-items-center text-chrome-neutral-500">
          {square ? <Music2 size={size === "card" ? 18 : 14} /> : <Film size={size === "card" ? 18 : 14} />}
        </div>
      )}
      {badge ? (
        <>
          {item.status !== "completed" ? <div className="absolute inset-0 bg-chrome-black/35" /> : null}
          <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-chrome-black/65 text-chrome-white">
            {badge}
          </span>
        </>
      ) : null}
    </div>
  );
}

function ProgressEdge({ fraction, muted }: { fraction: number | null; muted?: boolean }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-container-highest">
      <div
        className={`h-full bg-[var(--color-primary)] transition-[width] duration-200 ease-out ${
          fraction == null ? "w-1/3 animate-pulse" : ""
        } ${muted ? "opacity-45" : ""}`}
        style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}

/** The second line: what the download is doing now. */
function stageText(item: DownloadProgress): string {
  switch (item.status) {
    case "queued":
      return getString("download_stage_queued");
    case "muxing":
      return getString("download_stage_tagging");
    case "paused":
      return getString("download_paused");
    case "waitingForNetwork":
      return getString("download_waiting_network");
    case "completed":
      return getString("download_stage_saved", folderOf(item.filePath));
    case "failed":
      return item.error ?? getString("download_failed");
    case "cancelled":
      return getString("download_cancelled");
    default:
      return [item.artist, item.qualityLabel].filter(Boolean).join(" · ");
  }
}

/** The mono line under a running download: percent, bytes, speed and time left. */
function transferText(item: DownloadProgress): string | null {
  if (item.status !== "downloading") return null;
  const fraction = progressFraction(item);
  const parts = [
    fraction != null ? `${Math.round(fraction * 100)}%` : null,
    item.totalBytes
      ? `${formatBytes(item.downloadedBytes) ?? "0 MB"} of ${formatBytes(item.totalBytes)}`
      : formatBytes(item.downloadedBytes),
    formatSpeed(item.bytesPerSecond),
    formatTimeLeft(item.etaSeconds),
  ];
  return parts.filter(Boolean).join(" · ") || null;
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
  const [hovered, setHovered] = useState(false);
  const actions = useDownloadItemActions();
  const running = isRunning(item);
  const paused = item.status === "paused";
  const failed = item.status === "failed";
  const done = item.status === "completed" || item.status === "cancelled";
  useAutoDismiss(done, hovered, onDismiss);
  const detail = transferText(item);

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
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high p-2.5 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
    >
      <DockArtwork item={item} size="card" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-chrome-neutral-100">{item.title}</div>
        <div className={`mt-0.5 truncate text-xs ${failed ? "text-chrome-red-300" : "text-chrome-neutral-400"}`}>
          {stageText(item)}
        </div>
        {detail ? <div className="mt-0.5 truncate font-mono text-xs text-chrome-neutral-500">{detail}</div> : null}
        {item.status === "completed" ? (
          <div className="mt-1.5 flex gap-1">
            <TextAction primary onClick={() => actions.play(item)}>
              <Play size={13} />
              {getString("download_play")}
            </TextAction>
            <TextAction onClick={() => actions.reveal(item)}>{getString("download_show_in_folder")}</TextAction>
          </div>
        ) : failed ? (
          <div className="mt-1.5 flex gap-1">
            <TextAction primary onClick={() => void retryDownload(item.id)}>
              <RotateCcw size={13} />
              {getString("download_retry")}
            </TextAction>
            <TextAction onClick={onOpen}>{getString("download_details")}</TextAction>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5 self-start">
        {running && item.status !== "muxing" ? (
          <IconButton
            label={paused ? getString("download_resume") : getString("download_pause")}
            onClick={() => void (paused ? resumeDownload(item.id) : pauseDownload(item.id))}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </IconButton>
        ) : null}
        <IconButton
          label={running ? getString("download_cancel") : failed ? getString("download_discard") : getString("close")}
          onClick={() => {
            if (running) void cancelDownload(item.id);
            else {
              if (failed) void discardDownload(item.id);
              onDismiss();
            }
          }}
        >
          <X size={15} />
        </IconButton>
      </div>
      {running ? (
        <ProgressEdge fraction={item.status === "muxing" ? 1 : progressFraction(item)} muted={item.status !== "downloading"} />
      ) : null}
    </motion.div>
  );
}

/** One line of a batch card: the item's art, title and progress. */
function GroupRow({ item }: { item: DownloadProgress }) {
  const fraction = progressFraction(item);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-chrome-neutral-800 px-3 py-2">
      <DockArtwork item={item} size="row" />
      <div className="min-w-0">
        <div className="truncate text-xs text-chrome-neutral-200">{item.title}</div>
        {isRunning(item) ? (
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className={`h-full bg-[var(--color-primary)] ${fraction == null ? "w-1/3 animate-pulse" : ""}`}
              style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <span className="font-mono text-[11px] text-chrome-neutral-500">
        {item.status === "completed" ? (
          <CheckCircle2 size={15} className="text-chrome-neutral-300" />
        ) : item.status === "failed" ? (
          <AlertCircle size={15} className="text-chrome-red-400" />
        ) : item.status === "paused" ? (
          <Pause size={14} />
        ) : fraction != null ? (
          `${Math.round(fraction * 100)}%`
        ) : null}
      </span>
    </div>
  );
}

type GroupState = "running" | "paused" | "done" | "failed";

function GroupDockCard({
  title,
  detail,
  items,
  fraction,
  state,
  artwork,
  onTogglePause,
  onCancelAll,
  onDismiss,
}: {
  title: string;
  detail: string;
  items: DownloadProgress[];
  fraction: number | null;
  state: GroupState;
  artwork?: ReactNode;
  onTogglePause?: () => void;
  onCancelAll?: () => void;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const running = state === "running" || state === "paused";
  useAutoDismiss(state === "done", hovered, onDismiss);
  const shown = items.slice(0, GROUP_ROWS);
  const more = items.length - shown.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ ...DOCK_EXIT, transition: DOCK_EXIT_TRANSITION }}
      transition={DOWNLOAD_SURFACE_SPRING}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="relative overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
        {artwork ?? (
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-surface-container-highest text-chrome-neutral-300">
            {state === "done" ? <CheckCircle2 size={17} /> : state === "failed" ? <AlertCircle size={17} /> : <Film size={17} />}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-chrome-neutral-100">{title}</div>
          <div className="truncate font-mono text-xs text-chrome-neutral-500">{detail}</div>
        </div>
        <div className="flex items-center gap-0.5">
          {running && onTogglePause ? (
            <IconButton
              label={state === "paused" ? getString("download_queue_resume_all") : getString("download_queue_pause_all")}
              onClick={onTogglePause}
            >
              {state === "paused" ? <Play size={15} /> : <Pause size={15} />}
            </IconButton>
          ) : null}
          {running && onCancelAll ? (
            <IconButton label={getString("download_queue_cancel_all")} onClick={onCancelAll}>
              <X size={15} />
            </IconButton>
          ) : !running ? (
            <IconButton label={getString("close")} onClick={onDismiss}>
              <X size={15} />
            </IconButton>
          ) : null}
        </div>
      </div>
      {shown.map((item) => (
        <GroupRow key={item.id} item={item} />
      ))}
      {more > 0 ? (
        <div className="border-t border-chrome-neutral-800 px-3 py-1.5 text-xs text-chrome-neutral-500">
          {getString("download_more_items", more)}
        </div>
      ) : null}
      {running ? <ProgressEdge fraction={fraction} /> : null}
    </motion.div>
  );
}

function RunArtwork({ run }: { run: CollectionRun }) {
  const src = useProxiedImageUrl(run.thumbnailUrl);
  const square = run.kind === "album";
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-lg bg-surface-container-highest ${
        square ? "h-10 w-10" : "aspect-video w-[72px]"
      }`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-chrome-neutral-500">
          {square ? <Disc3 size={16} /> : <Film size={16} />}
        </div>
      )}
    </div>
  );
}

function groupSpeed(items: DownloadProgress[]): string | null {
  const total = items.reduce((sum, item) => sum + (item.status === "downloading" ? item.bytesPerSecond ?? 0 : 0), 0);
  return total > 0 ? formatSpeed(total) : null;
}

export function DownloadActivity() {
  const active = useDownloadStore((state) => state.active);
  const dialog = useDownloadStore((state) => state.dialog);
  const dismissProgress = useDownloadStore((state) => state.dismissProgress);
  const openActivity = useDownloadStore((state) => state.openActivity);
  const runs = useCollectionDownloadStore((state) => state.runs);
  const dismissRun = useCollectionDownloadStore((state) => state.dismissRun);
  useDownloadEvents();
  useDownloadConcurrency();

  if (dialog) return null;

  const all = Object.values(active);
  const solo = all.filter((item) => item.collectionDbId == null).reverse();

  const runCards = Object.values(runs).map((run) => {
    const items = all.filter((item) => item.collectionDbId === run.dbId);
    const inFlight = items.filter(isRunning);
    let progressSum = run.completed + run.failed;
    for (const item of inFlight) progressSum += progressFraction(item) ?? 0;
    const state: GroupState = run.active ? "running" : run.failed > 0 ? "failed" : "done";
    const kindLabel = getString(run.kind === "album" ? "download_album_label" : "download_playlist_label");
    const counts = getString("download_collection_run_progress", run.completed, run.total);
    const detail = [kindLabel, counts, groupSpeed(items)].filter(Boolean).join(" · ");
    return {
      run,
      items: state === "running" ? inFlight : [],
      fraction: run.total > 0 ? Math.min(1, progressSum / run.total) : null,
      state,
      detail,
    };
  });

  const single = solo.length === 1 ? solo[0] : undefined;
  const group = solo.length >= 2 ? solo : [];
  const groupRunning = group.filter(isRunning);
  const groupDone = group.filter((item) => item.status === "completed").length;
  const groupFailed = group.filter((item) => item.status === "failed").length;
  const groupState: GroupState =
    groupRunning.length === 0
      ? groupFailed > 0 ? "failed" : "done"
      : groupRunning.every((item) => item.status === "paused") ? "paused" : "running";
  const groupFraction =
    group.length > 0
      ? group.reduce((sum, item) => sum + (isRunning(item) ? progressFraction(item) ?? 0 : 1), 0) / group.length
      : null;

  const toggleGroupPause = () => {
    const resume = groupState === "paused";
    for (const item of groupRunning) {
      if (resume) {
        if (item.status === "paused") void resumeDownload(item.id);
      } else if (item.status !== "muxing" && item.status !== "paused") {
        void pauseDownload(item.id);
      }
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-[120] flex max-h-[70vh] w-[380px] max-w-[calc(100vw-3rem)] flex-col gap-2 overflow-y-auto overflow-x-hidden">
      <AnimatePresence initial={false}>
        {runCards.map(({ run, items, fraction, state, detail }) => (
          <GroupDockCard
            key={`run-${run.dbId}`}
            title={run.title}
            detail={detail}
            items={items}
            fraction={fraction}
            state={state}
            artwork={<RunArtwork run={run} />}
            onDismiss={() => dismissRun(run.dbId)}
          />
        ))}
        {group.length > 0 ? (
          <GroupDockCard
            key="queue"
            title={getString("download_group_title", group.length)}
            detail={[getString("download_group_progress", groupDone, group.length), groupSpeed(group)]
              .filter(Boolean)
              .join(" · ")}
            items={group}
            fraction={groupFraction}
            state={groupState}
            onTogglePause={toggleGroupPause}
            onCancelAll={() => groupRunning.forEach((item) => void cancelDownload(item.id))}
            onDismiss={() => {
              for (const item of group) {
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
