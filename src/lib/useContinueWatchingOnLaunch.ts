import { useCallback, useEffect, useRef, useState } from "react";
import { getWatchHistory } from "./api/db";
import { getHiddenContinueWatchingIds, hideContinueWatchingVideo } from "./continueWatching";
import { isDeepFlowCurrentlyActive } from "./deepFlow";
import { SETTINGS } from "./settings/schema";
import { buildContinueWatching } from "./useContinueWatching";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { VideoSummary } from "../types/video";

/** Enough history to reach past music and finished videos to the last one left unfinished. */
const HISTORY_SCAN = 50;

/**
 * Offers the last unfinished video once per launch, until anything plays. Nothing is resolved until
 * the viewer takes it up, so a launch costs one history read.
 */
export function useContinueWatchingOnLaunch() {
  const settingsLoaded = useAppSettingsStore((s) => s.loaded);
  const enabled = useAppSettingsStore((s) => s.values[SETTINGS.MINI_PLAYER_CONTINUE_WATCHING_ENABLED] !== "false");
  const somethingPlaying = usePlayerStore((s) => s.currentVideo !== null);
  const musicLoaded = useMusicPlayerStore((s) => s.currentTrack !== null);
  const [video, setVideo] = useState<VideoSummary | null>(null);
  const checkedRef = useRef(false);
  const playing = somethingPlaying || musicLoaded;
  const spentRef = useRef(false);

  useEffect(() => {
    if (!playing) return;
    spentRef.current = true;
    setVideo(null);
  }, [playing]);

  useEffect(() => {
    if (!settingsLoaded || checkedRef.current) return;
    checkedRef.current = true;
    if (!enabled || isDeepFlowCurrentlyActive()) return;
    getWatchHistory(HISTORY_SCAN, 0)
      .then((history) => {
        if (!spentRef.current) setVideo(buildContinueWatching(history, getHiddenContinueWatchingIds())[0] ?? null);
      })
      .catch((error) => console.warn("Failed to read the last watched video", error));
  }, [enabled, settingsLoaded]);

  const dismiss = useCallback(() => {
    if (video) hideContinueWatchingVideo(video.id);
    setVideo(null);
  }, [video]);

  return { video: playing ? null : video, dismiss };
}
