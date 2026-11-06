import { Film, Music2 } from "lucide-react";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import { formatBytes, formatDuration } from "../../lib/downloadOptions";
import { folderNameOf, watchStateOf, progressFraction, type PlaysById } from "../../lib/localMedia/filters";
import { getString } from "../../lib/i18n/index";
import { LocalFileMenuButton } from "./LocalFileMenuButton";

interface LocalFileItemProps {
  file: LocalMediaFile;
  plays: PlaysById;
  nowMs: number;
  onPlay: () => void;
}

function subtitleOf(file: LocalMediaFile): string {
  const size = formatBytes(file.sizeBytes);
  return [file.artist || folderNameOf(file.folderPath), size].filter(Boolean).join(" · ");
}

function Artwork({ file, plays, nowMs, className }: Omit<LocalFileItemProps, "onPlay"> & { className: string }) {
  const Icon = file.kind === "video" ? Film : Music2;
  const fraction = file.kind === "video" ? progressFraction(file, plays) : 0;
  const isNew = watchStateOf(file, plays, nowMs) === "new";
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-surface-container ${className}`}>
      <Icon className="h-8 w-8 text-chrome-neutral-600" aria-hidden />
      {isNew && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-on-primary">
          {getString("local_new_badge")}
        </span>
      )}
      {file.durationMs > 0 && (
        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-chrome-black/80 px-1.5 py-0.5 text-xs font-medium tabular-nums text-chrome-white">
          {formatDuration(file.durationMs / 1000)}
        </span>
      )}
      {fraction > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-chrome-black/40">
          <div className="h-full bg-primary" style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function LocalFileCard({ file, plays, nowMs, onPlay }: LocalFileItemProps) {
  return (
    <div className="group flex min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={onPlay}
        className="block w-full rounded-xl transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={file.title}
      >
        <Artwork file={file} plays={plays} nowMs={nowMs} className="aspect-video w-full" />
      </button>
      <div className="flex items-start gap-1 px-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-chrome-neutral-100" title={file.fileName}>
            {file.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-chrome-neutral-400">{subtitleOf(file)}</p>
        </div>
        <LocalFileMenuButton file={file} />
      </div>
    </div>
  );
}

export function LocalFileRow({ file, plays, nowMs, onPlay }: LocalFileItemProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200 ease-out hover:bg-surface-container-low">
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Artwork
          file={file}
          plays={plays}
          nowMs={nowMs}
          className={file.kind === "video" ? "aspect-video w-32 shrink-0" : "h-14 w-14 shrink-0"}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-chrome-neutral-100" title={file.fileName}>
            {file.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-chrome-neutral-400">{subtitleOf(file)}</span>
        </span>
      </button>
      <LocalFileMenuButton file={file} />
    </div>
  );
}
