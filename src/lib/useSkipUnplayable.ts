import { useEffect, useRef } from "react";
import { getString } from "./i18n/index";
import { usePlayerStore } from "../store/usePlayerStore";
import { useUiStore } from "../store/useUiStore";

/**
 * After this many skips with nothing playing in between, the network or the session is at fault
 * rather than the videos, so the queue stops on the error instead of burning through itself.
 */
export const MAX_UNPLAYABLE_SKIPS_IN_A_ROW = 2;

/**
 * Moves a queue past a video that can't play. Only one the queue moved to: a video the viewer picked
 * keeps its error on screen, since that says what is wrong and what they can do.
 */
export function useSkipUnplayable(videoId: string, streamError: string | null): void {
  const skipsRef = useRef(0);
  const seenVideoRef = useRef(videoId);
  const startedVideoId = usePlayerStore((s) => s.playbackStartedVideoId);

  useEffect(() => {
    if (startedVideoId) skipsRef.current = 0;
  }, [startedVideoId]);

  useEffect(() => {
    // The commit that changes the video still carries the last video's error.
    if (seenVideoRef.current !== videoId) {
      seenVideoRef.current = videoId;
      return;
    }
    if (!streamError) return;
    const { queue, currentIndex, currentVideo, queueAdvanceVideoId, playbackStartedVideoId, playNext } =
      usePlayerStore.getState();
    if (currentVideo?.id !== videoId || queueAdvanceVideoId !== videoId) return;
    // A video that played and then failed is a lost connection, not an unplayable video.
    if (playbackStartedVideoId === videoId) return;
    if (!queue[currentIndex + 1] || skipsRef.current >= MAX_UNPLAYABLE_SKIPS_IN_A_ROW) return;
    skipsRef.current += 1;
    useUiStore.getState().showToast({ variant: "info", message: getString("player_skipped_unplayable") });
    playNext();
  }, [streamError, videoId]);
}
