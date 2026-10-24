import { useEffect } from "react";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { getSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";
import { clearMusicQueueState, loadMusicQueueState, saveMusicQueueState } from "./api/musicQueue";
import { parseSavedQueue, serializeQueue } from "./musicQueuePersistence";
import { SETTINGS } from "./settings/schema";

/** Saves land this long after a change, so a burst of edits or a playing song writes rarely. */
const SAVE_DELAY_MS = 5_000;

const restoreEnabled = () => getSettingValue(SETTINGS.MUSIC_RESTORE_QUEUE) !== "false";

const settingsLoaded = (): Promise<void> =>
  new Promise((resolve) => {
    if (useAppSettingsStore.getState().loaded) {
      resolve();
      return;
    }
    const unsubscribe = useAppSettingsStore.subscribe((state) => {
      if (!state.loaded) return;
      unsubscribe();
      resolve();
    });
  });

function writeNow(): void {
  if (!restoreEnabled()) return;
  const state = useMusicPlayerStore.getState();
  const request =
    state.queue.length === 0
      ? clearMusicQueueState()
      : saveMusicQueueState(JSON.stringify(serializeQueue(state)));
  request.catch((error) => console.warn("Failed to save the music queue", error));
}

/**
 * Brings back the last session's queue at launch, paused on its song (Android's
 * QueuePersistence), and keeps the saved copy current: five seconds after a
 * change, and at once on a pause or when the app closes.
 */
export function useMusicQueuePersistence() {
  useEffect(() => {
    let cancelled = false;
    // Nothing is written until the saved queue has been read, or the empty
    // player at launch would overwrite it.
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (ready) writeNow();
    };
    const schedule = () => {
      if (timer === null) timer = setTimeout(flush, SAVE_DELAY_MS);
    };

    const unsubscribe = useMusicPlayerStore.subscribe((s, prev) => {
      if (!ready) return;
      if ((prev.isPlaying && !s.isPlaying) || (s.queue !== prev.queue && s.queue.length === 0)) {
        flush();
        return;
      }
      if (
        s.queue !== prev.queue ||
        s.currentIndex !== prev.currentIndex ||
        s.progress !== prev.progress ||
        s.queueSource !== prev.queueSource ||
        s.unshuffledQueue !== prev.unshuffledQueue ||
        s.radioQueuedIds !== prev.radioQueuedIds ||
        s.radioStationActive !== prev.radioStationActive
      ) {
        schedule();
      }
    });
    window.addEventListener("beforeunload", flush);

    void (async () => {
      await settingsLoaded();
      if (cancelled) return;
      if (restoreEnabled() && !useMusicPlayerStore.getState().currentTrack) {
        const saved = parseSavedQueue(await loadMusicQueueState().catch(() => null));
        if (cancelled) return;
        if (saved) useMusicPlayerStore.getState().restoreSavedQueue(saved);
      }
      ready = true;
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("beforeunload", flush);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
