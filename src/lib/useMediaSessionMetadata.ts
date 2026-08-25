import { useEffect } from "react";

import { usePlayerStore } from "../store/usePlayerStore";

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "nexttrack",
  "previoustrack",
];

/**
 * Publishes the playing video to the OS media controls. Whichever window owns
 * the media element calls this — the main window normally, the pop-out player
 * while it has playback — so the transport keys always reach the video that is
 * actually running.
 */
export function useMediaSessionMetadata(enabled: boolean) {
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);

  useEffect(() => {
    if (!enabled || !currentVideo || !("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentVideo.title,
        artist: currentVideo.channelName,
        artwork: currentVideo.thumbnailUrl ? [{ src: currentVideo.thumbnailUrl }] : undefined,
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch (error) {
      console.warn("Failed to update media session metadata", error);
    }

    try {
      navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler("nexttrack", () => playNext(true));
      navigator.mediaSession.setActionHandler("previoustrack", playPrevious);
    } catch (error) {
      console.warn("Failed to configure media session actions", error);
    }

    return () => {
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Some WebViews expose Media Session but not every action.
        }
      }
    };
  }, [enabled, currentVideo, isPlaying, playNext, playPrevious, setIsPlaying]);
}
