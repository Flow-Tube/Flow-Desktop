import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";

import type { RecapSummary } from "../../../lib/api/recap";
import { getString } from "../../../lib/i18n/index";
import { periodLabel as labelOf } from "../../../lib/recap/recapFormat";
import { storyPageMs } from "../../../lib/recap/storyClock";
import { storyPages } from "../../../lib/recap/storyPages";
import { useStoryTints } from "../../../lib/recap/storyTint";
import { useRecapPoster } from "../../../lib/recap/useRecapPoster";
import { useStoryAutoplay } from "../../../lib/recap/useStoryAutoplay";
import { IconButton } from "../../ui/IconButton";
import { StoryBackdrop, useStoryBackdrop } from "./StoryBackdrop";
import { StoryPageContent } from "./StoryPageContent";

/** A press longer than this was holding the page, not asking to step. */
const HOLD_MS = 250;
const PREVIOUS_ZONE = 0.3;
const CONTROL = "hover:bg-[var(--story-raised)] focus-visible:ring-2 focus-visible:ring-primary";
/**
 * The clock writes `transform` on the bar as the page runs. Tailwind's `scale-x-*` sets the separate
 * `scale` property, which multiplies with it, so a class here would hold the bar at zero for good.
 */
const EMPTY_BAR: CSSProperties = { transform: "scaleX(0)" };
/** Inside the story the theme's accent and raised surface take the page's colours. */
const PAGE_THEME = {
  "--color-primary": "var(--story-accent)",
  "--color-on-primary": "var(--story-ground)",
  "--color-surface-container-high": "var(--story-raised)",
} as CSSProperties;

interface RecapStoryProps {
  summary: RecapSummary;
  period: string;
  onClose: () => void;
}

/**
 * The recap as a story that plays itself over the whole window: each page runs for a few seconds in
 * its own colours, and the last one waits with a way to start over. Space pauses, the arrow keys
 * step and Esc closes; holding the page pauses it and clicking its sides steps.
 */
export function RecapStory({ summary, period, onClose }: RecapStoryProps) {
  const pages = useMemo(() => storyPages(summary), [summary]);
  const durations = useMemo(() => pages.map((item) => storyPageMs(item.kind)), [pages]);
  const tints = useStoryTints(pages, summary);
  const backdrop = useStoryBackdrop();
  const { page, paused, finished, setPaused, setHeld, goTo, replay, progressBar } = useStoryAutoplay(durations, backdrop.onFrame);
  const periodLabel = labelOf(period);
  // Made on opening, so the last page has its card ready by the time it arrives.
  const poster = useRecapPoster(summary, period, periodLabel, tints[tints.length - 1]!);
  const pressedAt = useRef<number | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const previousPage = useRef(0);
  const direction = page >= previousPage.current ? "next" : "prev";
  useEffect(() => {
    previousPage.current = page;
  }, [page]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  const togglePlayback = () => {
    if (finished) replay();
    else setPaused((value) => !value);
  };

  useEffect(() => {
    // Capture, so the player's own shortcuts don't also act on these keys under the story.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") goTo(page + 1);
      else if (event.key === "ArrowLeft") goTo(page - 1);
      else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) togglePlayback();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  const press = (event: PointerEvent<HTMLDivElement>) => {
    // A button on the page, such as saving the card, does its own thing without stepping the story.
    if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
    pressedAt.current = Date.now();
    setHeld(true);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    setHeld(false);
    const startedAt = pressedAt.current;
    pressedAt.current = null;
    if (startedAt === null || Date.now() - startedAt >= HOLD_MS) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    goTo((event.clientX - bounds.left) / bounds.width < PREVIOUS_ZONE ? page - 1 : page + 1);
  };
  const cancelHold = () => {
    pressedAt.current = null;
    setHeld(false);
  };

  const current = pages[page]!;
  const playbackLabel = getString(finished ? "recap_story_replay" : paused ? "recap_story_play" : "recap_story_pause");
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={getString("recap_title")}
      tabIndex={-1}
      style={{ ...tints[page], backgroundColor: "var(--story-ground)" }}
      className="fixed inset-0 z-[130] flex flex-col overflow-hidden outline-none transition-colors duration-500 ease-out"
    >
      <StoryBackdrop seed={page} near={backdrop.near} far={backdrop.far} />
      <div className="relative flex min-h-0 flex-1 flex-col" style={PAGE_THEME}>
        <div className="flex gap-1 px-5 pt-2">
          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={getString("recap_story_page", index + 1, pages.length)}
              aria-current={index === page ? "step" : undefined}
              onClick={() => goTo(index)}
              className="group/segment flex h-4 flex-1 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="block h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-on-surface)_22%,transparent)] transition-[height] duration-200 ease-out group-hover/segment:h-1.5">
                {index < page && <span className="block h-full w-full bg-primary" />}
                {index === page && <div ref={progressBar} className="h-full w-full origin-left bg-primary rtl:origin-right" style={EMPTY_BAR} />}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between px-3 py-1">
          <span className="px-2 text-sm tabular-nums text-on-surface-variant">
            {getString("recap_story_page", page + 1, pages.length)}
          </span>
          <div className="flex items-center gap-1">
            <IconButton aria-label={playbackLabel} title={playbackLabel} className={CONTROL} onClick={togglePlayback}>
              {finished ? <RotateCcw className="h-5 w-5" /> : paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </IconButton>
            <IconButton aria-label={getString("close")} title={getString("close")} className={CONTROL} onClick={onClose}>
              <X className="h-5 w-5" />
            </IconButton>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            className="flex h-full cursor-pointer select-none overflow-y-auto px-16 pb-8"
            onPointerDown={press}
            onPointerUp={release}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
          >
            <div key={page} className={`story-stagger story-page-${direction} m-auto flex w-full max-w-2xl flex-col items-center gap-5 text-center`}>
              <StoryPageContent page={current} summary={summary} period={period} periodLabel={periodLabel} poster={poster} />
            </div>
          </div>
          {page > 0 && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <IconButton aria-label={getString("recap_story_previous")} className={CONTROL} onClick={() => goTo(page - 1)}>
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
              </IconButton>
            </div>
          )}
          {page < pages.length - 1 && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <IconButton aria-label={getString("recap_story_next")} className={CONTROL} onClick={() => goTo(page + 1)}>
                <ChevronRight className="h-5 w-5 rtl:rotate-180" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
