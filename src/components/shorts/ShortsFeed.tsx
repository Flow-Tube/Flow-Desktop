import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useShortsFeed } from "../../lib/useShortsFeed";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { ShortPlayer } from "./ShortPlayer";
import type { ShortItem, ShortsPanelState } from "../../types/shorts";

const PREFETCH_WITHIN = 5;
const STREAM_PRELOAD_RADIUS = 1;

export function ShortsFeed() {
  const { videoId } = useParams<{ videoId?: string }>();
  const location = useLocation();
  const routeState = location.state as {
    initialShort?: ShortItem;
    initialQueue?: ShortItem[];
    queueOnly?: boolean;
  } | null;
  const initialShort = useMemo(() => {
    const candidate = routeState?.initialShort;
    if (!candidate || candidate.id !== videoId) return null;
    return candidate;
  }, [routeState, videoId]);
  const initialQueue = useMemo(() => {
    const candidate = routeState?.initialQueue;
    if (!candidate?.length || !videoId) return null;
    if (!candidate.some((short) => short.id === videoId)) return null;
    return candidate;
  }, [routeState, videoId]);
  const queueOnly = Boolean(routeState?.queueOnly && initialQueue);
  const { items, loading, error, loadMore } = useShortsFeed(
    videoId,
    initialShort,
    initialQueue,
    queueOnly,
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelState, setPanelState] = useState<ShortsPanelState>("none");
  const [muted, setMuted] = useState(true);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const playbackMode = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_PLAYBACK_MODE] ?? "loop");
  const autoScrollSeconds = useAppSettingsStore((state) => Number(state.values[SETTINGS.SHORTS_AUTO_SCROLL_SECONDS] ?? "10"));

  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const syncedRouteVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unmute = () => setMuted(false);
    const opts = { once: true } as const;
    window.addEventListener("pointerdown", unmute, opts);
    window.addEventListener("keydown", unmute, opts);
    window.addEventListener("wheel", unmute, opts);
    return () => {
      window.removeEventListener("pointerdown", unmute);
      window.removeEventListener("keydown", unmute);
      window.removeEventListener("wheel", unmute);
    };
  }, []);

  const markUnavailable = useCallback((id: string) => {
    setUnavailableIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(index)) setActiveIndex(index);
          }
        }
      },
      { root, threshold: [0.6] },
    );

    slideRefs.current.slice(0, items.length).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    if (items.length > 0 && activeIndex >= items.length - PREFETCH_WITHIN) {
      void loadMore();
    }
  }, [activeIndex, items.length, loadMore]);

  useEffect(() => {
    setPanelState("none");
  }, [activeIndex]);

  useEffect(() => {
    syncedRouteVideoIdRef.current = null;
    setActiveIndex(0);
    slideRefs.current[0]?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [videoId]);

  useEffect(() => {
    if (!videoId || items.length === 0) return;
    if (syncedRouteVideoIdRef.current === videoId) return;
    const index = items.findIndex((item) => item.id === videoId);
    if (index < 0) return;
    syncedRouteVideoIdRef.current = videoId;
    setActiveIndex(index);
    slideRefs.current[index]?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [items, videoId]);

  const feedStateRef = useRef({ activeIndex: 0, itemCount: 0 });
  useEffect(() => {
    feedStateRef.current = { activeIndex, itemCount: items.length };
  }, [activeIndex, items.length]);

  const scrollToIndex = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, feedStateRef.current.itemCount - 1));
    slideRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const advanceToNext = useCallback(() => {
    const { activeIndex: current, itemCount } = feedStateRef.current;
    if (itemCount === 0) return;
    if (current >= itemCount - 1) {
      void loadMore();
      return;
    }
    scrollToIndex(current + 1);
  }, [loadMore, scrollToIndex]);

  useEffect(() => {
    const active = items[activeIndex];
    if (!active || !unavailableIds.has(active.id)) return;
    if (activeIndex >= items.length - 1) {
      void loadMore();
      return;
    }
    const timer = window.setTimeout(() => scrollToIndex(activeIndex + 1), 500);
    return () => window.clearTimeout(timer);
  }, [activeIndex, items, unavailableIds, scrollToIndex, loadMore]);

  if (loading && items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6 text-center">
        <p className="text-sm text-chrome-neutral-400">
          {error ? "Couldn't load Shorts right now." : "No Shorts to show yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-background" data-panel={panelState}>
      <div
        ref={containerRef}
        className="hide-scrollbar h-full w-full snap-y snap-mandatory overflow-y-auto"
      >
        {items.map((short, index) => (
          <section
            key={short.id}
            ref={(el) => {
              slideRefs.current[index] = el;
            }}
            data-index={index}
            className="h-full w-full snap-start"
          >
            <ShortPlayer
              short={short}
              active={index === activeIndex}
              preload={Math.abs(index - activeIndex) <= STREAM_PRELOAD_RADIUS}
              muted={muted}
              playbackMode={playbackMode}
              autoScrollSeconds={Number.isFinite(autoScrollSeconds) ? autoScrollSeconds : 10}
              panelState={panelState}
              onRequestPanel={setPanelState}
              onToggleMute={() => setMuted((value) => !value)}
              onRequestAdvance={advanceToNext}
              onUnavailable={() => markUnavailable(short.id)}
            />
          </section>
        ))}
      </div>

      <div className="absolute right-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-3">
        <NavButton
          ariaLabel="Previous Short"
          disabled={activeIndex <= 0}
          onClick={() => scrollToIndex(activeIndex - 1)}
        >
          <ChevronUp className="h-5 w-5" />
        </NavButton>
        <NavButton
          ariaLabel="Next Short"
          disabled={activeIndex >= items.length - 1}
          onClick={() => scrollToIndex(activeIndex + 1)}
        >
          <ChevronDown className="h-5 w-5" />
        </NavButton>
      </div>
    </div>
  );
}

function NavButton({
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-chrome-neutral-800 bg-chrome-neutral-900 text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-chrome-neutral-800 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
