import { useMemo } from "react";
import { Copy, PenLine, Play, Trash2, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { RichText } from "../ui/RichText";
import { NoteImage, noteHeading } from "./NoteRow";
import { getString } from "../../lib/i18n/index";
import { formatTime } from "../../lib/musicFormat";
import { noteRichText, timeline } from "../../lib/note/noteMoments";
import { formatYouTubeRelativeTime } from "../../lib/publishedDate";
import { useNotesStore } from "../../store/useNotesStore";
import type { Note } from "../../lib/api/notes";
import type { RichTarget } from "../../types/video";

const noImages = () => "";

interface NoteDetailPaneProps {
  note: Note;
  onPlay: (note: Note, seconds?: number) => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function NoteDetailPane({ note, onPlay, onCopy, onDelete }: NoteDetailPaneProps) {
  const navigate = useNavigate();
  const duration = note.durationSeconds ?? 0;
  const isVideo = note.kind === "Video";
  const moments = useMemo(() => (isVideo ? timeline(note.text, duration) : []), [isVideo, note.text, duration]);
  const rich = useMemo(
    () => (isVideo ? noteRichText(note.text, duration) : { text: note.text, spans: [], emojis: [] }),
    [isVideo, note.text, duration],
  );
  const channelId = isVideo ? note.channelId : note.targetId;
  const edit = () =>
    useNotesStore.getState().openEditor({ kind: note.kind, targetId: note.targetId, subject: null });
  const activate = (target: RichTarget) => {
    if (target.kind === "timestamp") onPlay(note, target.seconds);
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <div className="flex items-start gap-4">
        <NoteImage note={note} className={isVideo ? "w-40 shrink-0" : "w-20 shrink-0"} />
        <div className="min-w-0 select-text">
          <h2 className="text-base font-medium text-chrome-neutral-100">{noteHeading(note)}</h2>
          {isVideo && note.channelName && <p dir="auto" className="mt-0.5 text-sm text-chrome-neutral-400">{note.channelName}</p>}
          {!isVideo && note.subscriberCountText && (
            <p className="mt-0.5 text-sm text-chrome-neutral-400">{note.subscriberCountText}</p>
          )}
          <p className="mt-1 text-xs text-chrome-neutral-500">
            {getString("note_edited", formatYouTubeRelativeTime(note.updatedAt))}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isVideo && (
          <Button onClick={() => onPlay(note)}>
            <Play size={18} />
            {getString("play")}
          </Button>
        )}
        <Button variant="tonal" onClick={edit}>
          <PenLine size={18} />
          {getString("note_edit")}
        </Button>
        {channelId && (
          <Button variant="tonal" onClick={() => navigate(`/channel/${encodeURIComponent(channelId)}`)}>
            <UserRound size={18} />
            {getString("note_open_channel")}
          </Button>
        )}
        <Button variant="tonal" onClick={onCopy}>
          <Copy size={18} />
          {getString("note_copy_text")}
        </Button>
        <Button variant="tonal" onClick={onDelete}>
          <Trash2 size={18} />
          {getString("delete")}
        </Button>
      </div>

      {moments.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-chrome-neutral-500">{getString("note_timestamps")}</h3>
          <ul className="mt-1 flex flex-col">
            {moments.map((moment) => (
              <li key={moment.seconds}>
                <button
                  type="button"
                  onClick={() => onPlay(note, moment.seconds)}
                  aria-label={getString("note_play_from", formatTime(moment.seconds))}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="font-medium tabular-nums text-primary">{formatTime(moment.seconds)}</span>
                  <span className="min-w-0 truncate text-chrome-neutral-300">{moment.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-chrome-neutral-500">{getString("note_title")}</h3>
        <div className="mt-1 select-text text-sm text-chrome-neutral-200">
          <RichText value={rich} onActivate={activate} imageSrc={noImages} />
        </div>
      </section>
    </div>
  );
}
