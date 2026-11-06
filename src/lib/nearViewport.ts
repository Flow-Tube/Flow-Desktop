import { useEffect, useState, type RefObject } from "react";

import { useScrollContainer } from "./useScrollContainer";

/** A card starts its work this far before it scrolls into view. */
const NEAR_MARGIN_PX = 600;
/** A card a fast scroll passes straight through never asks for anything. */
const DWELL_MS = 150;

/**
 * Offscreen feed cards are skipped by `content-visibility`, which leaves everything
 * inside them with no layout to observe, so a grid card is watched by its wrapper.
 */
const SKIPPED_WRAPPER = ".flow-grid-card";

interface Watcher {
  onNear: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** One observer per scroll root: a feed of several hundred cards must not create that many. */
const observers = new Map<Element | null, { observer: IntersectionObserver; watchers: Map<Element, Set<Watcher>> }>();

function observerFor(root: Element | null) {
  const existing = observers.get(root);
  if (existing) return existing;

  const watchers = new Map<Element, Set<Watcher>>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        for (const watcher of watchers.get(entry.target) ?? []) {
          if (!entry.isIntersecting) {
            if (watcher.timer !== null) clearTimeout(watcher.timer);
            watcher.timer = null;
          } else if (watcher.timer === null) {
            watcher.timer = setTimeout(() => {
              watcher.timer = null;
              watcher.onNear();
            }, DWELL_MS);
          }
        }
      }
    },
    { root, rootMargin: `${NEAR_MARGIN_PX}px` },
  );
  const shared = { observer, watchers };
  observers.set(root, shared);
  return shared;
}

function watchNear(element: Element, scrollRoot: Element | null, onNear: () => void): () => void {
  const target = element.closest(SKIPPED_WRAPPER) ?? element;
  // An observer never reports a target outside its root, and a panel or dialog can
  // live outside the page's scroller.
  const root = scrollRoot?.contains(target) ? scrollRoot : null;
  const shared = observerFor(root);
  const watcher: Watcher = { onNear, timer: null };

  let group = shared.watchers.get(target);
  if (!group) {
    group = new Set();
    shared.watchers.set(target, group);
    shared.observer.observe(target);
  }
  group.add(watcher);

  return () => {
    if (watcher.timer !== null) clearTimeout(watcher.timer);
    group.delete(watcher);
    if (group.size > 0) return;
    shared.watchers.delete(target);
    shared.observer.unobserve(target);
    if (shared.watchers.size === 0) {
      shared.observer.disconnect();
      observers.delete(root);
    }
  };
}

/** True once the element has come near the screen, and it stays true. Stays false while disabled. */
export function useNearViewport(ref: RefObject<Element | null> | undefined, enabled: boolean): boolean {
  const scrollContainer = useScrollContainer();
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (!enabled || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const element = ref?.current;
    if (!element) return;
    return watchNear(element, scrollContainer?.current ?? null, () => setNear(true));
  }, [enabled, near, ref, scrollContainer]);

  return near;
}
