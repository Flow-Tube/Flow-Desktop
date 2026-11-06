import { useCallback, useEffect, useMemo, useState } from "react";
import { getWatchHistory } from "./api/db";
import { SETTINGS, type SettingKey } from "./settings/schema";
import { useEventVersion } from "./useEventVersion";
import { finishedShortIds, watchedVideoIds, type WatchedThreshold } from "./watchedThreshold";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useFeedHiddenFilter } from "../store/useFeedActionsStore";
import { HISTORY_UPDATED_EVENT } from "../store/useHistoryStore";
import type { WatchHistoryRecord } from "../types/db";
import type { VideoSummary } from "../types/video";

const HISTORY_LOOKBACK = 2000;

export type HideWatchedSurface = "home" | "subscriptions";

const SURFACE_KEYS: Record<HideWatchedSurface, SettingKey> = {
  home: SETTINGS.HIDE_WATCHED_HOME_FEED,
  subscriptions: SETTINGS.HIDE_WATCHED_SUBSCRIPTIONS,
};

/** A surface's own choice; until one is made it follows the one switch that syncs with the phone. */
export function resolveHideWatched(surfaceValue: string | undefined, legacyValue: string | undefined): boolean {
  return (surfaceValue || legacyValue) === "true";
}

export function useHideWatched(surface: HideWatchedSurface): boolean {
  return useAppSettingsStore((state) =>
    resolveHideWatched(state.values[SURFACE_KEYS[surface]], state.values[SETTINGS.HIDE_WATCHED_VIDEOS]),
  );
}

function useWatchHistory(enabled: boolean): WatchHistoryRecord[] {
  const [history, setHistory] = useState<WatchHistoryRecord[]>([]);
  const version = useEventVersion(HISTORY_UPDATED_EVENT);
  useEffect(() => {
    if (!enabled) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    getWatchHistory(HISTORY_LOOKBACK, 0)
      .then((records) => {
        if (!cancelled) setHistory(records);
      })
      .catch((error) => console.warn("Failed to read watch history for filtering", error));
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);
  return history;
}

/** The feed filter of a surface: what the viewer hid and, by their choice, what they watched. */
export function useFeedVisibilityFilter(surface: HideWatchedSurface) {
  const hideWatched = useHideWatched(surface);
  const isHidden = useFeedHiddenFilter({ hideWatched });
  const watched = useWatchedVideoIds(hideWatched);
  return useCallback((video: VideoSummary) => isHidden(video) || watched.has(video.id), [isHidden, watched]);
}

/** The videos history counts as watched, read only while something needs them. */
export function useWatchedVideoIds(enabled: boolean): Set<string> {
  const threshold = useAppSettingsStore((state) => state.values[SETTINGS.WATCHED_THRESHOLD]) as WatchedThreshold;
  const history = useWatchHistory(enabled);
  return useMemo(() => watchedVideoIds(history, threshold), [history, threshold]);
}

/** The Shorts a shelf leaves out, under the Shorts setting alone. */
export function useFinishedShortIds(): Set<string> {
  const hideWatched = useAppSettingsStore((state) => state.values[SETTINGS.HIDE_WATCHED_SHORTS] !== "false");
  const history = useWatchHistory(hideWatched);
  return useMemo(() => finishedShortIds(history), [history]);
}

/** The Shorts the feed leaves out right now, for code outside a render. */
export async function loadFinishedShortIds(): Promise<Set<string>> {
  if (useAppSettingsStore.getState().values[SETTINGS.HIDE_WATCHED_SHORTS] === "false") return new Set();
  try {
    return finishedShortIds(await getWatchHistory(HISTORY_LOOKBACK, 0));
  } catch (error) {
    console.warn("Failed to read watch history for the Shorts feed", error);
    return new Set();
  }
}
