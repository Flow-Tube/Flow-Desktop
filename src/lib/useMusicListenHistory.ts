import { useEffect } from "react";
import { onBeforeProfileSwitch } from "./profiles/beforeSwitch";

import { useLocalMediaStore } from "../store/useLocalMediaStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { shouldRecordWatchHistory } from "./deepFlow";
import { isLocalMediaId } from "./localMediaId";
import { MusicListenTracker } from "./musicListenTracker";
import { recordSongHistory } from "./musicHistory";
import { rememberResumePosition } from "./musicResume";
import { RecapMusicSession } from "./recap/musicSession";

const recapListening = new RecapMusicSession();

/** The one tracker the audio element's events feed. */
export const musicListens = new MusicListenTracker({
  // A library file keeps its own history: as on Android, it teaches MusicBrain nothing and
  // stays out of the shared history that syncs.
  recordListen: (track, listenedSeconds, durationSeconds) => {
    if (isLocalMediaId(track.videoId ?? track.id)) return;
    void recordSongHistory(track, listenedSeconds, durationSeconds);
    recapListening.note(track, listenedSeconds, durationSeconds);
  },
  recordPosition: (track, positionSeconds, durationSeconds) => {
    const id = track.videoId ?? track.id;
    if (!isLocalMediaId(id)) rememberResumePosition(track, positionSeconds, durationSeconds);
    else if (shouldRecordWatchHistory()) {
      useLocalMediaStore.getState().notePlayback(id, positionSeconds, durationSeconds);
    }
  },
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
