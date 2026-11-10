import { useEffect, useRef, useState } from "react";
import { StickyNote, TimerReset } from "lucide-react";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";
import { noteId } from "../../lib/api/notes";
import { formatTime } from "../../lib/musicFormat";
import { insertMoment } from "../../lib/note/noteMoments";
import { useNotesStore, type NoteEditorTarget } from "../../store/useNotesStore";

/** Writes or clears one note. Saving empty text deletes it, so there is no separate delete here. */
function NoteEditor({ target }: { target: NoteEditorTarget }) {
  const initial = useNotesStore.getState().notes[noteId(target.kind, target.targetId)]?.text ?? "";
  const save = useNotesStore((state) => state.save);
  const close = useNotesStore((state) => state.closeEditor);
  const [text, setText] = useState(initial);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingCursor = useRef<number | null>(initial.length);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field || pendingCursor.current === null) return;
    field.focus();
    field.setSelectionRange(pendingCursor.current, pendingCursor.current);
    pendingCursor.current = null;
  }, [text]);

  const commit = () => {
    void save(target.kind, target.targetId, text, target.subject);
    close();
  };
  const insert = () => {
    if (target.insertAtSeconds === undefined) return;
    const next = insertMoment(text, fieldRef.current?.selectionStart ?? text.length, target.insertAtSeconds);
    pendingCursor.current = next.cursor;
    setText(next.text);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Stopped on the way down, so the player's shortcuts never see what is typed here.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const stops = [...(cardRef.current?.querySelectorAll<HTMLElement>("button, textarea") ?? [])];
        const current = stops.indexOf(document.activeElement as HTMLElement);
        stops[(current + (event.shiftKey ? stops.length - 1 : 1)) % stops.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={close}
      role="presentation"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-editor-title"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
      >
        <h2 id="note-editor-title" className="flex items-center gap-2 text-lg font-bold tracking-tight text-chrome-neutral-100">
          <StickyNote size={20} className="shrink-0 text-primary" />
          {getString(target.kind === "Channel" ? "note_channel_title" : "note_video_title")}
        </h2>
        {target.insertAtSeconds !== undefined && (
          <button
            type="button"
            onClick={insert}
            className="flex w-fit items-center gap-2 rounded-full border border-chrome-neutral-800 px-3 py-1 text-sm font-medium tabular-nums text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <TimerReset size={16} className="text-primary" />
            {getString("note_insert_time", formatTime(target.insertAtSeconds))}
          </button>
        )}
        <textarea
          ref={fieldRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={getString("note_placeholder")}
          rows={6}
          className="w-full resize-y select-text rounded-lg border border-chrome-neutral-700 bg-surface-container-high px-3 py-2 text-sm text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-500 hover:border-chrome-neutral-600 focus:border-chrome-neutral-500"
        />
        <div className="flex justify-end gap-2">
          <Button variant="tonal" onClick={close}>
            {getString("cancel")}
          </Button>
          <Button onClick={commit}>{getString("save")}</Button>
        </div>
      </div>
    </div>
  );
}

/** Shows the editor the notes store asks for. Mounted once app-wide, so it works in fullscreen too. */
export function NoteEditorHost() {
  const target = useNotesStore((state) => state.editor);
  useEffect(() => {
    useNotesStore.setState({ editorHosted: true });
    return () => useNotesStore.setState({ editorHosted: false });
  }, []);
  return target ? <NoteEditor key={`${target.kind}:${target.targetId}`} target={target} /> : null;
}
