import { Check, StickyNote } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { formatYouTubeRelativeTime } from "../../lib/publishedDate";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { Note } from "../../lib/api/notes";

export function noteHeading(note: Note): string {
  return note.title || getString(note.kind === "Video" ? "note_unknown_video" : "note_channel_note");
}

export function noteImage(note: Note): string | null {
  if (note.thumbnailUrl) return note.thumbnailUrl;
  if (note.kind === "Video") return `https://i.ytimg.com/vi/${note.targetId}/hqdefault.jpg`;
  return note.channelAvatarUrl || null;
}

export function NoteImage({ note, className }: { note: Note; className: string }) {
  const src = useProxiedImageUrl(noteImage(note));
  const shape = note.kind === "Channel" ? "aspect-square rounded-full" : "aspect-video rounded-xl";
  return src ? (
    <img src={src} alt="" className={`${className} ${shape} bg-surface-container-high object-cover`} />
  ) : (
    <span className={`${className} ${shape} grid place-items-center bg-surface-container-high text-chrome-neutral-500`}>
      <StickyNote size={18} />
    </span>
  );
}

interface NoteRowProps {
  note: Note;
  active: boolean;
  /** Present while selecting: whether this row is one of the selected. */
  checked?: boolean;
  onClick: () => void;
}

export function NoteRow({ note, active, checked, onClick }: NoteRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked ?? active}
      className={`flex w-full items-start gap-3 rounded-xl p-2.5 text-start transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active || checked ? "bg-surface-container" : ""
      }`}
    >
      {checked !== undefined && (
        <span
          className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
            checked ? "border-primary bg-primary text-on-primary" : "border-chrome-neutral-700"
          }`}
        >
          {checked && <Check size={14} />}
        </span>
      )}
      <span className="w-24 shrink-0">
        <NoteImage note={note} className={note.kind === "Channel" ? "mx-auto block w-14" : "block w-24"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{noteHeading(note)}</span>
        <span className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-chrome-neutral-400">{note.text}</span>
        <span className="mt-0.5 block text-xs text-chrome-neutral-500">
          {getString("note_edited", formatYouTubeRelativeTime(note.updatedAt))}
        </span>
      </span>
    </button>
  );
}
