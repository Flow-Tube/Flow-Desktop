import { useEffect } from "react";
import { onBeforeProfileSwitch } from "./profiles/beforeSwitch";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { MusicListenTracker } from "./musicListenTracker";
import { recordSongHistory } from "./musicHistory";
import { rememberResumePosition } from "./musicResume";

/** The one tracker the audio element's events feed. */
export const musicListens = new MusicListenTracker({
  recordListen: (track, listenedSeconds, durationSeconds) =>
    void recordSongHistory(track, listenedSeconds, durationSeconds),
  recordPosition: rememberResumePosition,
});

/** Closes a song's listen when the player moves on, and saves it when the app closes. */
export function useMusicListenHistory() {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const currentId = currentTrack ? (currentTrack.videoId ?? currentTrack.id) : null;

  useEffect(() => {
    musicListens.switchTo(useMusicPlayerStore.getState().currentTrack, Date.now());
  }, [currentId]);

  useEffect(() => {
    const flush = () => musicListens.flush();
    window.addEventListener("beforeunload", flush);
    const offSwitch = onBeforeProfileSwitch(flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      offSwitch();
    };
  }, []);
}
