import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import { createPortal } from "react-dom";

import type { RecapSummary } from "../../../lib/api/recap";
import { getString } from "../../../lib/i18n/index";
import { periodLabel as labelOf } from "../../../lib/recap/recapFormat";
import { storyPages } from "../../../lib/recap/storyPages";
import { useStoryAutoplay } from "../../../lib/recap/useStoryAutoplay";
import { IconButton } from "../../ui/IconButton";
import { StoryPageContent } from "./StoryPageContent";

/** A press longer than this was holding the page, not asking to step. */
const HOLD_MS = 250;
const PREVIOUS_ZONE = 0.3;
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-primary";

interface RecapStoryProps {
  summary: RecapSummary;
  period: string;
  onClose: () => void;
}

/**
 * The recap as a story that plays itself over the whole window: each page runs for a few seconds.
 * Space pauses, the arrow keys step and Esc closes; holding the page pauses it and clicking its
 * sides steps.
 */
export function RecapStory({ summary, period, onClose }: RecapStoryProps) {
  const pages = useMemo(() => storyPages(summary), [summary]);
  const { page, paused, setPaused, setHeld, goTo, progressBar } = useStoryAutoplay(pages.length);
  const pressedAt = useRef<number | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const periodLabel = labelOf(period);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  useEffect(() => {
    // Capture, so the player's own shortcuts don't also act on these keys under the story.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") goTo(page + 1);
      else if (event.key === "ArrowLeft") goTo(page - 1);
      else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) setPaused((value) => !value);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [goTo, onClose, page, setPaused]);

  const press = () => {
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
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={getString("recap_title")}
      tabIndex={-1}
      className="fixed inset-0 z-[130] flex flex-col bg-background outline-none"
    >
      <div className="flex gap-1 px-5 pt-4" aria-hidden="true">
        {pages.map((_, index) => (
          <div key={index} className="h-1 flex-1 overflow-hidden rounded-full bg-surface-container-high">
            {index < page && <div className="h-full w-full bg-primary" />}
            {index === page && <div ref={progressBar} className="h-full w-full origin-left scale-x-0 bg-primary" />}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="px-2 text-sm tabular-nums text-on-surface-variant">
          {getString("recap_story_page", page + 1, pages.length)}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={getString(paused ? "recap_story_play" : "recap_story_pause")}
            className={FOCUS_RING}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          </IconButton>
          <IconButton aria-label={getString("close")} className={FOCUS_RING} onClick={onClose}>
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
        >
          <div key={page} className="m-auto flex w-full max-w-xl flex-col items-center gap-5 text-center animate-pane-in">
            <StoryPageContent page={current} summary={summary} period={period} periodLabel={periodLabel} />
          </div>
        </div>
        {page > 0 && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <IconButton aria-label={getString("recap_story_previous")} className={FOCUS_RING} onClick={() => goTo(page - 1)}>
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
          </div>
        )}
        {page < pages.length - 1 && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <IconButton aria-label={getString("recap_story_next")} className={FOCUS_RING} onClick={() => goTo(page + 1)}>
              <ChevronRight className="h-5 w-5" />
            </IconButton>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
