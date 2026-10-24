import { useEffect } from "react";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useLikesStore } from "../store/useLikesStore";
import { getSettingValue } from "../store/useAppSettingsStore";
import { isTauriEnv } from "./api/env";
import { reportListened, reportLove, reportNowPlaying, reportOnline, scrobbleTrack } from "./api/scrobble";
import { isDeepFlowCurrentlyActive } from "./deepFlow";
import { likeChange } from "./scrobble/likeChange";
import { ListenTracker, type ListenEvent } from "./scrobble/listenTracker";
import { SETTINGS, type SettingKey } from "./settings/schema";

const enabled = (key: SettingKey) => getSettingValue(key) === "true";

/** As on Android, Deep Flow keeps listens private unless the listener allowed them. */
function scrobblingAllowed(): boolean {
  return !isDeepFlowCurrentlyActive() || enabled(SETTINGS.DEEP_FLOW_SCROBBLE);
}

function send(event: ListenEvent): void {
  if (!scrobblingAllowed()) return;
  const track = scrobbleTrack(event.track, event.durationMs);
  if (event.kind === "nowPlaying") {
    if (enabled(SETTINGS.SCROBBLE_NOW_PLAYING)) void reportNowPlaying(track);
  } else {
    void reportListened(track, event.playedMs, event.startedAtMs);
  }
}

// Reports what the music player plays to the scrobbling backend. Only the music player feeds
// it, so videos are never scrobbled.
export function useScrobbleReporter(): void {
  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void isTauriEnv().then((inTauri) => {
      if (!inTauri || disposed) return;
      const tracker = new ListenTracker();
      const observe = () => {
        const player = useMusicPlayerStore.getState();
        const events = tracker.update({
          track: player.currentTrack,
          playing: player.isPlaying,
          buffering: player.isBuffering,
          progress: player.progress,
          duration: player.duration,
        }, Date.now());
        events.forEach(send);
      };
      observe();
      cleanups.push(useMusicPlayerStore.subscribe(observe));

      cleanups.push(useLikesStore.subscribe((next, previous) => {
        const change = likeChange(previous, next);
        if (!change || !enabled(SETTINGS.SCROBBLE_LOVE_LIKES)) return;
        void reportLove(scrobbleTrack(change.song, (change.song.duration ?? 0) * 1000), change.liked);
      }));

      const onOnline = () => void reportOnline();
      window.addEventListener("online", onOnline);
      cleanups.push(() => window.removeEventListener("online", onOnline));
    });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
}
