import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { CheckSquare, Copy, ListOrdered, Loader2, StickyNote, Trash2, X } from "lucide-react";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { Select } from "../components/ui/Select";
import { CategoryChips } from "../components/layout/CategoryChips";
import { NoteDetailPane } from "../components/note/NoteDetailPane";
import { NoteRow } from "../components/note/NoteRow";
import { NotesReorderList } from "../components/note/NotesReorderList";
import { getPlural, getString, type StringKey } from "../lib/i18n/index";
import { NOTES_FILTERS, NOTES_SORTS, type NotesSort } from "../lib/note/notesFiltering";
import { useNotesPage } from "../lib/note/useNotesPage";
import { seekWhenVideoReady } from "../lib/playerSeek";
import type { Note } from "../lib/api/notes";
import type { VideoSummary } from "../types/video";

const FILTER_LABELS: Record<(typeof NOTES_FILTERS)[number], StringKey> = {
  all: "notes_filter_all",
  videos: "notes_filter_videos",
  channels: "notes_filter_channels",
};

const SORT_LABELS: Record<NotesSort, StringKey> = {
  recent: "notes_sort_recent",
  oldest: "notes_sort_oldest",
  title: "notes_sort_title",
  custom: "notes_sort_custom",
};

function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-chrome-neutral-800 px-6 py-16 text-center">
      <StickyNote size={32} className="text-chrome-neutral-500" />
      <h2 className="text-base font-medium text-chrome-neutral-100">{title}</h2>
      {body && <p className="max-w-md text-sm text-chrome-neutral-400">{body}</p>}
      {action}
    </div>
  );
}

export const Notes: React.FC<{ onPlay: (video: VideoSummary) => void }> = ({ onPlay }) => {
  const page = useNotesPage();
  const requested = (useLocation().state as { openNote?: string } | null)?.openNote;
  const { setOpenId } = page;
  useEffect(() => {
    if (requested) setOpenId(requested);
  }, [requested, setOpenId]);

  const play = (note: Note, seconds?: number) => {
    onPlay({
      id: note.targetId,
      title: note.title ?? "",
      channelName: note.channelName ?? "",
      channelId: note.channelId ?? "",
      thumbnailUrl: note.thumbnailUrl ?? "",
      durationSeconds: note.durationSeconds ?? null,
    });
    if (seconds !== undefined) seekWhenVideoReady(seconds);
  };

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-6 pb-20 pt-8 md:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("notes_title")}</h1>
          <p className="mt-1 text-sm text-chrome-neutral-400">
            {page.all.length > 0
              ? getPlural("notes_count", page.all.length)
              : getString("notes_library_subtitle")}
          </p>
        </div>
        {!page.reordering && page.all.length > 0 && (
          <SearchInput
            value={page.query}
            onChange={(event) => page.setQuery(event.target.value)}
            placeholder={getString("notes_search_placeholder")}
            containerClassName="w-full sm:w-72"
          />
        )}
      </header>

      {!page.loaded ? (
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      ) : page.loadError ? (
        <EmptyState
          title={getString("notes_load_failed")}
          action={
            <Button variant="tonal" onClick={() => void page.reload()}>
              {getString("retry")}
            </Button>
          }
        />
      ) : page.all.length === 0 ? (
        <EmptyState title={getString("notes_empty_title")} body={getString("notes_empty_body")} />
      ) : page.reordering ? (
        <NotesReorderList notes={page.visible} onMove={page.move} onDone={page.stopReordering} />
      ) : (
        <>
          {page.selecting ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 text-sm font-medium tabular-nums text-chrome-neutral-200">
                {getPlural("notes_selected", page.selectedNotes.length)}
              </span>
              <Button variant="tonal" onClick={page.selectAll}>
                <CheckSquare size={18} />
                {getString("notes_select_all")}
              </Button>
              <Button variant="tonal" disabled={page.selectedNotes.length === 0} onClick={() => void page.copySelected()}>
                <Copy size={18} />
                {getString("notes_copy")}
              </Button>
              <Button variant="tonal" disabled={page.selectedNotes.length === 0} onClick={() => void page.remove(page.selectedNotes)}>
                <Trash2 size={18} />
                {getString("delete")}
              </Button>
              <Button variant="tonal" onClick={page.startReordering}>
                <ListOrdered size={18} />
                {getString("notes_reorder")}
              </Button>
              <Button variant="ghost" onClick={page.stopSelecting}>
                <X size={18} />
                {getString("cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Select
                value={page.sort}
                onChange={(value) => page.setSort(value as NotesSort)}
                options={NOTES_SORTS.map((sort) => ({ value: sort, label: getString(SORT_LABELS[sort]) }))}
                className="w-full md:w-52"
              />
              <CategoryChips
                categories={NOTES_FILTERS.map((filter) => getString(FILTER_LABELS[filter]))}
                activeCategory={getString(FILTER_LABELS[page.filter])}
                onCategoryChange={(label) => {
                  const filter = NOTES_FILTERS.find((key) => getString(FILTER_LABELS[key]) === label);
                  if (filter) page.setFilter(filter);
                }}
                sticky={false}
                className="py-0"
              />
              <Button variant="tonal" className="md:ml-auto" onClick={page.startSelecting}>
                <CheckSquare size={18} />
                {getString("notes_select")}
              </Button>
            </div>
          )}

          {page.visible.length === 0 ? (
            <EmptyState title={getString("notes_no_match_title")} body={getString("notes_no_match_body")} />
          ) : (
            <div className="grid grid-cols-12 gap-6">
              <ul className="col-span-12 flex flex-col gap-1 lg:col-span-5">
                {page.visible.map((note) => (
                  <li key={note.id}>
                    <NoteRow
                      note={note}
                      active={page.openNote?.id === note.id}
                      checked={page.selecting ? !!page.selected?.has(note.id) : undefined}
                      onClick={() => (page.selecting ? page.toggleSelected(note.id) : page.setOpenId(note.id))}
                    />
                  </li>
                ))}
              </ul>
              <div className="col-span-12 lg:sticky lg:top-6 lg:col-span-7 lg:self-start">
                {page.openNote ? (
                  <NoteDetailPane
                    note={page.openNote}
                    onPlay={play}
                    onCopy={() => void page.copyNote(page.openNote as Note)}
                    onDelete={() => void page.remove([page.openNote as Note])}
                  />
                ) : (
                  <p className="hidden rounded-2xl border border-dashed border-chrome-neutral-800 p-10 text-center text-sm text-chrome-neutral-500 lg:block">
                    {getString("notes_pick_title")}
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Notes;
