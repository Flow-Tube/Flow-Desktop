import { useState, type ReactNode } from "react";
import { Loader2, Music2, Pencil } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { pickFolder } from "../../../lib/dialogs";
import { formatBytes, formatDuration } from "../../../lib/downloadOptions";
import { SETTINGS } from "../../../lib/settings/schema";
import { useMusicDownloadDialog, type EditableTags, type LyricsStatus } from "../../../lib/useMusicDownloadDialog";
import { useAppSettingsStore } from "../../../store/useAppSettingsStore";
import type { SongItem } from "../../../types/music";
import { TextInput } from "../../ui/TextInput";
import { DialogFooter, DialogFrame, DialogHeader, SectionLabel } from "./DownloadDialogShell";

function QualityCard({
  selected,
  title,
  detail,
  onSelect,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`grid gap-0.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors duration-200 ease-out ${
        selected
          ? "border-chrome-neutral-500 bg-surface-container"
          : "border-chrome-neutral-800 hover:bg-surface-container-low"
      }`}
    >
      <span className="font-medium text-chrome-neutral-100">{title}</span>
      <span className="font-mono text-xs text-chrome-neutral-400">{detail}</span>
    </button>
  );
}

/** One tag row; editable ones turn into a field when clicked. */
function TagRow({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <dt className="border-t border-chrome-neutral-800 bg-surface-container-low px-3 py-2 text-xs text-chrome-neutral-500 first-of-type:border-t-0">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center justify-between gap-2 border-t border-chrome-neutral-800 px-3 py-1.5 text-sm text-chrome-neutral-200 first-of-type:border-t-0">
        {onChange && editing ? (
          <TextInput
            value={value ?? ""}
            onChange={onChange}
            autoFocus
            aria-label={label}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setEditing(false);
            }}
            className="h-7 w-full"
          />
        ) : onChange ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 py-0.5 text-left transition-colors hover:text-chrome-neutral-100"
          >
            <span className="truncate">{value || "—"}</span>
            <Pencil size={13} className="shrink-0 text-chrome-neutral-500" />
          </button>
        ) : (
          children
        )}
      </dd>
    </>
  );
}

function lyricsLabel(status: LyricsStatus): ReactNode {
  switch (status) {
    case "looking":
      return (
        <span className="inline-flex items-center gap-1.5 text-chrome-neutral-400">
          <Loader2 size={13} className="animate-spin" />
          {getString("download_lyrics_looking")}
        </span>
      );
    case "synced":
      return getString("download_lyrics_synced");
    case "plain":
      return getString("download_lyrics_plain");
    default:
      return <span className="text-chrome-neutral-500">{getString("download_lyrics_none")}</span>;
  }
}

export function MusicDownloadDialog({ track, onClose }: { track: SongItem; onClose: () => void }) {
  const state = useMusicDownloadDialog(track);
  const defaultFolder = useAppSettingsStore(
    (store) => store.values[SETTINGS.MUSIC_DOWNLOAD_LOCATION] || getString("settings_system_default_music"),
  );
  const setTag = (key: keyof EditableTags) => (value: string) => state.setTags({ ...state.tags, [key]: value });
  const start = async () => {
    if (await state.submit()) onClose();
  };
  const changeFolder = async () => {
    const path = await pickFolder(getString("settings_music_download_folder"));
    if (path) state.setFolder(path);
  };
  const highDetail = `AAC · ${state.highKbps ?? 128} kbps${formatBytes(state.sizes.High) ? ` · ≈ ${formatBytes(state.sizes.High)}` : ""}`;
  const lowDetail = `AAC · 48 kbps${formatBytes(state.sizes.Low) ? ` · ≈ ${formatBytes(state.sizes.Low)}` : ""}`;
  const credit = [track.album?.name, track.duration ? formatDuration(track.duration) : null].filter(Boolean).join(" · ");

  return (
    <DialogFrame onClose={onClose}>
      <DialogHeader
        artwork={track.thumbnail}
        shape="square"
        fallbackIcon={<Music2 size={22} />}
        title={track.title}
        subtitle={track.artists.map((artist) => artist.name).join(", ")}
        meta={credit || null}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-4">
        <div role="radiogroup" aria-label={getString("download_quality")} className="grid gap-2 sm:grid-cols-2">
          <QualityCard
            selected={state.quality === "High"}
            title={getString("download_quality_high")}
            detail={highDetail}
            onSelect={() => state.setQuality("High")}
          />
          <QualityCard
            selected={state.quality === "Low"}
            title={getString("download_quality_data_saver")}
            detail={lowDetail}
            onSelect={() => state.setQuality("Low")}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>{getString("download_saved_in_file")}</SectionLabel>
          <span className="text-xs text-chrome-neutral-500">{getString("download_tags_hint")}</span>
        </div>
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] overflow-hidden rounded-xl border border-chrome-neutral-800">
          <TagRow label={getString("download_tag_title")} value={state.tags.title} onChange={setTag("title")} />
          <TagRow label={getString("download_tag_artist")} value={state.tags.artist} onChange={setTag("artist")} />
          <TagRow label={getString("download_tag_album")} value={state.tags.album} onChange={setTag("album")} />
          {track.album?.id ? (
            <TagRow label={getString("download_tag_track_year")}>
              <span className="text-chrome-neutral-400">{getString("download_from_album")}</span>
            </TagRow>
          ) : null}
          <TagRow label={getString("download_tag_lyrics")}>{lyricsLabel(state.lyrics)}</TagRow>
          <TagRow label={getString("download_tag_cover")}>
            <span className="text-chrome-neutral-400">{getString("download_cover_square")}</span>
          </TagRow>
        </dl>
        {state.errorMessage ? (
          <p role="alert" className="text-sm text-chrome-red-300">{state.errorMessage}</p>
        ) : null}
      </div>
      <DialogFooter
        fileName={state.fileName}
        extension="m4a"
        folder={state.folder ?? defaultFolder}
        onChangeFolder={() => void changeFolder()}
        sizeLabel={formatBytes(state.quality === "Low" ? state.sizes.Low : state.sizes.High)}
        starting={state.starting}
        disabled={state.loading && !state.highKbps}
        onCancel={onClose}
        onSubmit={() => void start()}
      />
    </DialogFrame>
  );
}
