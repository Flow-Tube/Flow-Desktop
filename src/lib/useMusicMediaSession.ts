import { useEffect } from "react";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { musicAudioEngine } from "./audio/musicAudioEngine";
import { upgradeMusicImageUrl } from "./thumbnails";
import {
  claimMediaSession,
  refreshMediaSession,
  registerMediaSessionClient,
} from "./mediaSessionArbiter";

/** How far the OS seek-forward and seek-back keys move when they name no offset. */
const SEEK_STEP_SECONDS = 10;

/** Publishes the playing song to the OS media controls through the shared arbiter. */
export function useMusicMediaSession() {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const hasTrack = currentTrack !== null;

  useEffect(() => {
    if (!hasTrack) return;
    const store = useMusicPlayerStore.getState;
    const seekBy = (seconds: number) => store().seek(Math.max(0, musicAudioEngine.getCurrentTime() + seconds));
    return registerMediaSessionClient("music", {
      metadata: () => {
        const track = store().currentTrack;
        if (!track) return null;
        const artwork = upgradeMusicImageUrl(track.thumbnail, 512);
        return {
          title: track.title,
          artist: track.artists.map((a) => a.name).join(", "),
          album: track.album?.name ?? "",
          artwork: artwork ? [{ src: artwork, sizes: "512x512", type: "image/jpeg" }] : [],
        };
      },
      isPlaying: () => store().isPlaying,
      position: () => ({ position: musicAudioEngine.getCurrentTime(), duration: store().duration }),
      actions: {
        play: () => store().play(),
        pause: () => store().pause(),
        stop: () => store().pause(),
        previoustrack: () => store().previous(),
        nexttrack: () => store().next(),
        seekto: (details) => {
          if (typeof details.seekTime === "number") store().seek(details.seekTime);
        },
        seekforward: (details) => seekBy(details.seekOffset ?? SEEK_STEP_SECONDS),
        seekbackward: (details) => seekBy(-(details.seekOffset ?? SEEK_STEP_SECONDS)),
      },
      pause: () => store().pause(),
    });
  }, [hasTrack]);

  useEffect(() => {
    refreshMediaSession("music");
  }, [currentTrack]);

  useEffect(() => {
    if (!hasTrack) return;
    if (isPlaying) claimMediaSession("music");
    else refreshMediaSession("music");
  }, [hasTrack, isPlaying]);
}
