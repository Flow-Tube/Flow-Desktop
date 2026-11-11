import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";

/** Pauses the music and video players, for something that is about to make sound of its own. */
export function pauseOtherPlayback(): void {
  const music = useMusicPlayerStore.getState();
  if (music.isPlaying) music.pause();
  const video = usePlayerStore.getState();
  if (video.isPlaying) video.setIsPlaying(false);
}
