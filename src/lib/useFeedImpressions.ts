import { useEffect, useRef, type RefObject } from "react";
import { IMPRESSION_DWELL_MS, IMPRESSION_VISIBLE_SHARE, noteImpression } from "./feedImpressions";
import type { VideoSummary } from "../types/video";

/** Attribute a grid puts on each card it wants counted. */
export const IMPRESSION_ATTRIBUTE = "data-impression-id";

/**
 * Watches the cards inside `containerRef` and counts each one that stays at least half on
 * screen for half a second, through `onSeen`. Only cards actually rendered can count, so capped
 * or prefetched videos never do.
 */
export function useFeedImpressions(
  containerRef: RefObject<HTMLElement | null>,
  videos: VideoSummary[],
  enabled: boolean,
  onSeen: (video: VideoSummary) => void = noteImpression,
) {
  const onSeenRef = useRef(onSeen);
  useEffect(() => {
    onSeenRef.current = onSeen;
  }, [onSeen]);
  const videosRef = useRef(new Map<string, VideoSummary>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedRef = useRef(new Set<Element>());

  useEffect(() => {
    videosRef.current = new Map(videos.map((video) => [video.id, video]));
  }, [videos]);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_VISIBLE_SHARE;
          const timer = timers.get(entry.target);
          if (!visible) {
            if (timer !== undefined) clearTimeout(timer);
            timers.delete(entry.target);
            continue;
          }
          if (timer !== undefined) continue;
          const target = entry.target;
          timers.set(
            target,
            setTimeout(() => {
              timers.delete(target);
              const id = target.getAttribute(IMPRESSION_ATTRIBUTE);
              const video = id ? videosRef.current.get(id) : undefined;
              if (video) onSeenRef.current(video);
            }, IMPRESSION_DWELL_MS),
          );
        }
      },
      { threshold: [0, IMPRESSION_VISIBLE_SHARE] },
    );
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      for (const timer of timers.values()) clearTimeout(timer);
      observerRef.current = null;
      observedRef.current.clear();
    };
  }, [enabled]);

  // Cards that left the grid are released; new ones are added.
  useEffect(() => {
    const observer = observerRef.current;
    const container = containerRef.current;
    if (!observer || !container) return;
    const observed = observedRef.current;
    for (const element of observed) {
      if (!container.contains(element)) {
        observer.unobserve(element);
        observed.delete(element);
      }
    }
    container.querySelectorAll(`[${IMPRESSION_ATTRIBUTE}]`).forEach((element) => {
      if (observed.has(element)) return;
      observed.add(element);
      observer.observe(element);
    });
  }, [containerRef, videos, enabled]);
}
