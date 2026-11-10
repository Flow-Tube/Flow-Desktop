import { useEffect } from "react";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { isLocalMediaId } from "./localMediaId";
import { useMusicEnabled } from "./useMusicContent";

/** Turning Show Music off stops YouTube Music where it plays. Local files carry on. */
export function useStopMusicWhenHidden() {
  const musicEnabled = useMusicEnabled();
  useEffect(() => {
    if (musicEnabled) return;
    const { currentTrack, dismiss } = useMusicPlayerStore.getState();
    if (currentTrack && !isLocalMediaId(currentTrack.videoId ?? currentTrack.id)) dismiss();
  }, [musicEnabled]);
}
