import { useEffect } from "react";
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CURRENT_WINDOW_LABEL, IS_MAIN_WINDOW } from "./appWindow";
import { onSyncRefresh } from "./api/sync";
import { focusMainWindow } from "./api/pip";
import { pauseAllMediaSessionClients, setMediaSessionClaimListener } from "./mediaSessionArbiter";
import { refreshForSettingKeys, refreshSyncedCollections } from "./storeRefresh";
import {
  DATA_CHANGED_EVENT,
  MUSIC_PLAY_EVENT,
  OPEN_ROUTE_EVENT,
  PLAYBACK_CLAIMED_EVENT,
  type DataChangedPayload,
} from "./windowEvents";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useTabsStore } from "../store/useTabsStore";
import type { SongItem } from "../types/music";

interface MusicPlayPayload {
  queue: SongItem[];
  index: number;
  source: string | null;
}

/**
 * Music plays only in the main window, which owns the saved queue, the tray
 * and scrobbling. A song started anywhere else is handed to it.
 */
function forwardMusicToMainWindow(): () => void {
  return useMusicPlayerStore.subscribe((state, previous) => {
    const track = state.currentTrack;
    if (!track || track === previous.currentTrack) return;
    const queue = state.unshuffledQueue ?? state.queue;
    const index = Math.max(0, queue.findIndex((song) => song.videoId === track.videoId));
    void focusMainWindow().catch(() => {});
    void emitTo("main", MUSIC_PLAY_EVENT, { queue, index, source: state.queueSource } satisfies MusicPlayPayload).catch(() => {});
    state.dismiss();
  });
}

/** Keeps this window's cached data and playback in step with the other Flow windows. */
export function useCrossWindowSync(): void {
  useEffect(() => {
    const subscriptions: Array<Promise<UnlistenFn>> = [
      listen<DataChangedPayload>(DATA_CHANGED_EVENT, ({ payload }) => {
        if (payload.source !== CURRENT_WINDOW_LABEL) void refreshForSettingKeys(payload.keys);
      }),
      onSyncRefresh((collections) => void refreshSyncedCollections(collections)),
      listen<{ source: string }>(PLAYBACK_CLAIMED_EVENT, ({ payload }) => {
        if (payload.source !== CURRENT_WINDOW_LABEL) pauseAllMediaSessionClients();
      }),
    ];
    if (IS_MAIN_WINDOW) {
      subscriptions.push(
        listen<MusicPlayPayload>(MUSIC_PLAY_EVENT, ({ payload }) => {
          void useMusicPlayerStore.getState().playQueue(payload.queue, payload.index, payload.source);
        }),
        listen<string>(OPEN_ROUTE_EVENT, ({ payload }) => useTabsStore.getState().push(payload)),
      );
    }
    const stopForwarding = IS_MAIN_WINDOW ? null : forwardMusicToMainWindow();
    setMediaSessionClaimListener(() => {
      void emit(PLAYBACK_CLAIMED_EVENT, { source: CURRENT_WINDOW_LABEL }).catch(() => {});
    });

    return () => {
      setMediaSessionClaimListener(null);
      stopForwarding?.();
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, []);
}
