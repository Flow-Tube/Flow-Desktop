import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Languages,
  MoreVertical,
  Pencil,
  RefreshCw,
  Save,
  SearchCheck,
  Timer,
  Type,
} from "lucide-react";

import type { SongItem } from "../../../types/music";
import type { LyricsAlign } from "../../../lib/lyrics/display/presentation";
import { useLyricsStore } from "../../../store/useLyricsStore";
import { useLyricsActions, currentLyricsText } from "../../../lib/lyrics/useLyricsActions";
import { useBoolPref, usePreference } from "../../../lib/usePreference";
import { SETTINGS } from "../../../lib/settings/schema";
import { getString } from "../../../lib/i18n/index";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { LyricsSourcesDialog } from "./LyricsSourcesDialog";
import { LyricsEditDialog } from "./LyricsEditDialog";

const ROW =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-200 ease-out hover:bg-surface-container-high";

function MenuRow({ icon, title, supporting, onClick }: { icon: ReactNode; title: string; supporting?: string | null; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={ROW}>
      <span className="shrink-0 text-chrome-neutral-400">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-chrome-neutral-100">{title}</span>
        {supporting && <span className="block truncate text-xs text-chrome-neutral-400">{supporting}</span>}
      </span>
    </button>
  );
}

function SwitchRow({ icon, title, supporting, checked, onChange }: { icon: ReactNode; title: string; supporting: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200 ease-out hover:bg-surface-container-high">
      <span className="shrink-0 text-chrome-neutral-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-chrome-neutral-100">{title}</span>
        <span className="block text-xs text-chrome-neutral-400">{supporting}</span>
      </span>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

const ALIGNS: Array<{ value: LyricsAlign; label: "lyrics_align_left" | "lyrics_align_center" | "lyrics_align_right"; Icon: typeof AlignLeft }> = [
  { value: "left", label: "lyrics_align_left", Icon: AlignLeft },
  { value: "center", label: "lyrics_align_center", Icon: AlignCenter },
  { value: "right", label: "lyrics_align_right", Icon: AlignRight },
];

const seconds = (ms: number): string => `${ms > 0 ? "+" : ""}${(ms / 1000).toFixed(1)}`;

/**
 * Port of Android's LyricsActionsSheet as a menu: refresh, choose the source, edit, copy and save
 * the lyrics; alignment, translation and romanization; and the sync offset controls.
 */
export function LyricsActionsMenu({ track, className }: { track: SongItem | null; className: string }) {
  const [open, setOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [editText, setEditText] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const providerName = useLyricsStore((s) => s.providerName);
  const hasLyrics = useLyricsStore((s) => s.entries.length > 0 || !!s.plain?.trim());
  const syncOffsetMs = useLyricsStore((s) => s.syncOffsetMs);
  const candidates = useLyricsStore((s) => s.candidates);
  const isBrowsing = useLyricsStore((s) => s.isBrowsing);
  const { refresh, browseCandidates, cancelBrowse, applyCandidate, applyEdited, setShowSyncControls } = useLyricsStore.getState();
  const [align, setAlign] = usePreference(SETTINGS.LYRICS_TEXT_ALIGN);
  const [showTranslation, setShowTranslation] = useBoolPref(SETTINGS.LYRICS_SHOW_TRANSLATION);
  const [showRomanization, setShowRomanization] = useBoolPref(SETTINGS.LYRICS_SHOW_ROMANIZATION);
  const { copy, save } = useLyricsActions(track);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", onPointer, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={getString("lyrics_actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
            className="absolute right-0 top-full z-30 mt-2 w-80 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-2"
          >
            <MenuRow
              icon={<RefreshCw className="h-5 w-5" />}
              title={getString("music_refresh_lyrics")}
              supporting={providerName ? getString("lyrics_current_source", providerName) : null}
              onClick={run(refresh)}
            />
            <MenuRow
              icon={<SearchCheck className="h-5 w-5" />}
              title={getString("lyrics_choose_source")}
              onClick={run(() => {
                setSourcesOpen(true);
                browseCandidates();
              })}
            />
            {hasLyrics && (
              <>
                <MenuRow icon={<Pencil className="h-5 w-5" />} title={getString("lyrics_edit")} onClick={run(() => setEditText(currentLyricsText()))} />
                <MenuRow icon={<Copy className="h-5 w-5" />} title={getString("lyrics_copy")} onClick={run(() => void copy())} />
                <MenuRow icon={<Save className="h-5 w-5" />} title={getString("lyrics_save_file")} onClick={run(() => void save())} />
              </>
            )}

            <div className="mt-2 border-t border-chrome-neutral-800 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              {getString("lyrics_display_header")}
            </div>
            <div className="flex gap-1 px-3 py-2" role="radiogroup" aria-label={getString("lyrics_alignment")}>
              {ALIGNS.map(({ value, label, Icon }) => {
                const checked = align === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={getString(label)}
                    onClick={() => setAlign(value)}
                    className={`grid h-11 flex-1 place-items-center transition-colors duration-200 ease-out ${
                      checked
                        ? "rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                        : "rounded-lg bg-surface-container-high text-chrome-neutral-300 hover:bg-surface-container-highest"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
            <SwitchRow
              icon={<Languages className="h-5 w-5" />}
              title={getString("lyrics_show_translation")}
              supporting={getString("lyrics_show_translation_summary")}
              checked={showTranslation}
              onChange={setShowTranslation}
            />
            <SwitchRow
              icon={<Type className="h-5 w-5" />}
              title={getString("lyrics_show_romanization")}
              supporting={getString("lyrics_show_romanization_summary")}
              checked={showRomanization}
              onChange={setShowRomanization}
            />
            <div className="mt-1 border-t border-chrome-neutral-800 pt-1">
              <MenuRow
                icon={<Timer className="h-5 w-5" />}
                title={getString("lyrics_adjust_sync")}
                supporting={syncOffsetMs !== 0 ? getString("lyrics_sync_offset_value", seconds(syncOffsetMs)) : null}
                onClick={run(() => setShowSyncControls(true))}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {sourcesOpen && (
        <LyricsSourcesDialog
          candidates={candidates}
          isBrowsing={isBrowsing}
          currentProviderName={providerName}
          onSelect={(candidate) => {
            applyCandidate(candidate);
            setSourcesOpen(false);
          }}
          onClose={() => {
            cancelBrowse();
            setSourcesOpen(false);
          }}
        />
      )}
      {editText !== null && <LyricsEditDialog initialText={editText} onApply={applyEdited} onClose={() => setEditText(null)} />}
    </div>
  );
}
