import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MENU_ENTER_TRANSITION, MENU_EXIT_TRANSITION } from "../../../lib/motion";
import { canKeepScreenOn } from "../../../lib/useKeepScreenOn";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Droplets,
  Languages,
  MoreVertical,
  Pencil,
  Sun,
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
import { IS_LINUX_RUNTIME } from "../../../lib/platform";
import { getString } from "../../../lib/i18n/index";
import { isLocalMediaId } from "../../../lib/localMediaId";
import { lyricsSourceLabel } from "../../../lib/lyrics/offline";
import { lyricsBackgroundOptions, useLyricsBackground, type LyricsBackground } from "../../../lib/lyrics/useLyricsCover";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { LyricsSourcesDialog } from "./LyricsSourcesDialog";
import { LyricsEditDialog } from "./LyricsEditDialog";

const HOVER = "transition-colors duration-150 ease-out hover:bg-surface-container-highest focus-visible:bg-surface-container-highest focus-visible:outline-none";

function Separator() {
  return <div role="separator" className="mx-1.5 my-1.5 border-t border-chrome-neutral-800" />;
}

/** An action as a tile in the top row, the way card menus show their quick actions. */
function Tile({ icon, label, title, onClick }: { icon: ReactNode; label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-md px-1 pb-2 pt-2.5 text-xs text-chrome-neutral-200 ${HOVER}`}
    >
      <span className="grid h-5 w-5 place-items-center text-chrome-neutral-300">{icon}</span>
      <span className="line-clamp-1 max-w-full">{label}</span>
    </button>
  );
}

/** One line per switch; the longer explanation stays in Settings and shows on hover. */
function SwitchRow({ icon, title, hint, checked, onChange, nested = false }: { icon?: ReactNode; title: string; hint: string; checked: boolean; onChange: (v: boolean) => void; nested?: boolean }) {
  return (
    <div title={hint} className={`flex h-10 items-center gap-3 rounded-md pe-1.5 ${nested ? "ps-9" : "ps-2.5"} ${HOVER}`}>
      {icon && <span className="grid h-4 w-4 shrink-0 place-items-center text-chrome-neutral-400">{icon}</span>}
      <span className={`min-w-0 flex-1 truncate text-sm ${nested ? "text-chrome-neutral-300" : "text-chrome-neutral-200"}`}>{title}</span>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

interface Choice<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** A labelled row of equal buttons; the chosen one is a filled pill, as in Android's button groups. */
function ChoiceRow<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <div className="px-2.5 py-1.5">
      <p className="pb-1.5 text-xs text-chrome-neutral-400">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((choice) => {
          const checked = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={choice.label}
              onClick={() => onChange(choice.value)}
              className={`flex h-9 min-w-0 items-center justify-center text-xs font-medium transition-[background-color,color,border-radius] duration-200 ease-out ${
                checked
                  ? "rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                  : "rounded-md bg-surface-container text-chrome-neutral-300 hover:bg-surface-container-highest"
              }`}
            >
              {choice.icon ?? <span className="truncate px-1">{choice.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const alignChoices = (): Choice<LyricsAlign>[] => [
  { value: "left", label: getString("lyrics_align_left"), icon: <AlignLeft className="h-4 w-4" /> },
  { value: "center", label: getString("lyrics_align_center"), icon: <AlignCenter className="h-4 w-4" /> },
  { value: "right", label: getString("lyrics_align_right"), icon: <AlignRight className="h-4 w-4" /> },
];

const isAlign = (value: string): value is LyricsAlign => value === "left" || value === "center" || value === "right";

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
  const [autoRomanize, setAutoRomanize] = useBoolPref(SETTINGS.LYRICS_AUTO_ROMANIZE);
  const [romanizationOnly, setRomanizationOnly] = useBoolPref(SETTINGS.LYRICS_ROMANIZATION_ONLY);
  const [keepScreenOn, setKeepScreenOn] = useBoolPref(SETTINGS.LYRICS_KEEP_SCREEN_ON);
  const [blurOtherLines, setBlurOtherLines] = useBoolPref(SETTINGS.LYRICS_BLUR_OTHER_LINES);
  const background = useLyricsBackground();
  const [, setBackground] = usePreference(SETTINGS.LYRICS_BACKGROUND);
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

  // A library file's own lyrics are all it gets, so there is nothing to look up.
  const canLookUp = !isLocalMediaId(useLyricsStore.getState().videoId);
  const tiles = [
    canLookUp && <Tile key="refresh" icon={<RefreshCw className="h-5 w-5" />} label={getString("refresh")} title={getString("music_refresh_lyrics")} onClick={run(refresh)} />,
    canLookUp && (
      <Tile
        key="source"
        icon={<SearchCheck className="h-5 w-5" />}
        label={getString("lyrics_tile_source")}
        title={getString("lyrics_choose_source")}
        onClick={run(() => {
          setSourcesOpen(true);
          browseCandidates();
        })}
      />
    ),
    hasLyrics && <Tile key="edit" icon={<Pencil className="h-5 w-5" />} label={getString("lyrics_tile_edit")} title={getString("lyrics_edit")} onClick={run(() => setEditText(currentLyricsText()))} />,
    hasLyrics && <Tile key="copy" icon={<Copy className="h-5 w-5" />} label={getString("lyrics_tile_copy")} title={getString("lyrics_copy")} onClick={run(() => void copy())} />,
    hasLyrics && <Tile key="save" icon={<Save className="h-5 w-5" />} label={getString("save")} title={getString("lyrics_save_file")} onClick={run(() => void save())} />,
  ].filter(Boolean);

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
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: MENU_ENTER_TRANSITION }}
            exit={{ opacity: 0, scale: 0.98, transition: MENU_EXIT_TRANSITION }}
            style={{ transformOrigin: "top right" }}
            className="absolute end-0 top-full z-30 mt-2 max-h-[calc(100dvh-var(--app-titlebar-height)-7rem)] w-80 overflow-y-auto overscroll-contain rounded-lg border border-chrome-neutral-800 bg-surface-container-high p-1.5 text-sm"
          >
            <div className="px-1.5 pb-2 pt-1">
              <p className="font-medium text-chrome-neutral-100">{getString("music_lyrics")}</p>
              {providerName && (
                <p className="mt-0.5 truncate text-xs text-chrome-neutral-400">{getString("lyrics_current_source", lyricsSourceLabel(providerName))}</p>
              )}
            </div>
            {tiles.length > 0 && (
              <div className="grid gap-1 border-t border-chrome-neutral-800 pt-1.5" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
                {tiles}
              </div>
            )}

            <Separator />
            <ChoiceRow label={getString("lyrics_alignment")} value={isAlign(align) ? align : "center"} choices={alignChoices()} onChange={setAlign} />
            <ChoiceRow<LyricsBackground>
              label={getString("lyrics_background")}
              value={background}
              choices={lyricsBackgroundOptions()}
              onChange={setBackground}
            />

            <Separator />
            <SwitchRow
              icon={<Languages className="h-4 w-4" />}
              title={getString("lyrics_show_translation")}
              hint={getString("lyrics_show_translation_summary")}
              checked={showTranslation}
              onChange={setShowTranslation}
            />
            <SwitchRow
              icon={<Type className="h-4 w-4" />}
              title={getString("lyrics_show_romanization")}
              hint={getString("lyrics_show_romanization_summary")}
              checked={showRomanization}
              onChange={setShowRomanization}
            />
            {showRomanization && (
              <>
                <SwitchRow
                  nested
                  title={getString("lyrics_romanization_only")}
                  hint={getString("lyrics_romanization_only_summary")}
                  checked={romanizationOnly}
                  onChange={setRomanizationOnly}
                />
                <SwitchRow
                  nested
                  title={getString("lyrics_auto_romanize")}
                  hint={getString("lyrics_auto_romanize_summary")}
                  checked={autoRomanize}
                  onChange={setAutoRomanize}
                />
              </>
            )}
            {/* Linux never draws this blur, because the engine would do it on the CPU. */}
            {!IS_LINUX_RUNTIME && (
              <SwitchRow
                icon={<Droplets className="h-4 w-4" />}
                title={getString("lyrics_blur_other_lines")}
                hint={getString("lyrics_blur_other_lines_summary")}
                checked={blurOtherLines}
                onChange={setBlurOtherLines}
              />
            )}
            {canKeepScreenOn() && (
              <SwitchRow
                icon={<Sun className="h-4 w-4" />}
                title={getString("lyrics_keep_screen_on")}
                hint={getString("lyrics_keep_screen_on_summary")}
                checked={keepScreenOn}
                onChange={setKeepScreenOn}
              />
            )}

            <Separator />
            <button
              type="button"
              role="menuitem"
              onClick={run(() => setShowSyncControls(true))}
              className={`flex h-10 w-full items-center gap-3 rounded-md px-2.5 text-start ${HOVER}`}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center text-chrome-neutral-400">
                <Timer className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-chrome-neutral-200">{getString("lyrics_adjust_sync")}</span>
              {syncOffsetMs !== 0 && (
                <span className="shrink-0 font-mono text-xs text-chrome-neutral-400">{getString("lyrics_sync_offset_value", seconds(syncOffsetMs))}</span>
              )}
            </button>
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
