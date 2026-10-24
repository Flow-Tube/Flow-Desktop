import { useEffect } from "react";

import { usePlayerStore } from "../store/usePlayerStore";
import { seekToTime } from "./playerSeek";
import {
  claimMediaSession,
  refreshMediaSession,
  registerMediaSessionClient,
  reportMediaPosition,
} from "./mediaSessionArbiter";

/** How far the OS seek-forward and seek-back keys move when they name no offset. */
const SEEK_STEP_SECONDS = 10;

/**
 * Publishes the playing video to the OS media controls through the shared
 * arbiter. Whichever window owns the media element calls this (the main
 * window normally, the pop-out player while it has playback), so the transport
 * keys always reach the video that is actually running.
 */
export function useMediaSessionMetadata(enabled: boolean) {
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = enabled && currentVideo !== null;

  useEffect(() => {
    if (!active) return;
    const store = usePlayerStore.getState;
    const seekBy = (seconds: number) => seekToTime(Math.max(0, store().currentTime + seconds));
    const unregister = registerMediaSessionClient("video", {
      metadata: () => {
        const video = store().currentVideo;
        if (!video) return null;
        return {
          title: video.title,
          artist: video.channelName,
          artwork: video.thumbnailUrl ? [{ src: video.thumbnailUrl }] : undefined,
        };
      },
      isPlaying: () => store().isPlaying,
      position: () => ({
        position: store().currentTime,
        duration: store().duration,
        playbackRate: store().playbackRate,
      }),
      actions: {
        play: () => store().setIsPlaying(true),
        pause: () => store().setIsPlaying(false),
        stop: () => store().setIsPlaying(false),
        nexttrack: () => store().playNext(true),
        previoustrack: () => store().playPrevious(),
        seekto: (details) => {
          if (typeof details.seekTime === "number") seekToTime(details.seekTime);
        },
        seekforward: (details) => seekBy(details.seekOffset ?? SEEK_STEP_SECONDS),
        seekbackward: (details) => seekBy(-(details.seekOffset ?? SEEK_STEP_SECONDS)),
      },
      pause: () => store().setIsPlaying(false),
    });
    // The player writes its clock into the store; the OS scrubber follows it.
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) reportMediaPosition("video");
    });
    return () => {
      unsubscribe();
      unregister();
    };
  }, [active]);

  useEffect(() => {
    refreshMediaSession("video");
  }, [currentVideo]);

  useEffect(() => {
    if (!active) return;
    if (isPlaying) claimMediaSession("video");
    else refreshMediaSession("video");
  }, [active, isPlaying]);
}
