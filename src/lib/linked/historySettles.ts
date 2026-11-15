import { useEffect } from "react";

import { watchHistorySettled } from "../api/db";
import { usePlayerStore } from "../../store/usePlayerStore";

/** What the video player has loaded, and whether it plays. */
export interface PlayerItem {
  item: string | null;
  playing: boolean;
}

/** Whether going from `before` to `after` settles `before`'s history entry: playback paused or stopped, or moved on. */
export function historySettled(before: PlayerItem, after: PlayerItem): boolean {
  return (before.playing && !after.playing) || (before.item !== null && before.item !== after.item);
}

const itemOf = (state: ReturnType<typeof usePlayerStore.getState>): PlayerItem => ({
  item: state.currentVideo?.id ?? null,
  playing: state.isPlaying,
});

/**
 * Tells the backend each time the video player pauses, stops or moves on, so the history it saved
 * every few seconds while playing goes to the other devices then, as on Flow for Android. A song's
 * listen is saved once it ends, so the music player needs nothing here.
 */
export function useHistorySettles(): void {
  useEffect(() => {
    let before = itemOf(usePlayerStore.getState());
    return usePlayerStore.subscribe((state) => {
      const after = itemOf(state);
      if (after.item === before.item && after.playing === before.playing) return;
      if (historySettled(before, after)) void watchHistorySettled().catch(() => undefined);
      before = after;
    });
  }, []);
}
