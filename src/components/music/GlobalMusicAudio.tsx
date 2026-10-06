import { useEffect, useRef, type SyntheticEvent } from "react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { musicAudioEngine } from "../../lib/audio/musicAudioEngine";
import { PRELOAD_LEAD_SECONDS } from "../../lib/musicPreload";
import { recordSongHistory } from "../../lib/musicHistory";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import type { SongItem } from "../../types/music";

const HISTORY_PERSIST_MS = 5000;
/**
 * Media-time delta below which a progress write is skipped. A seek always
 * exceeds it, so scrubbing still lands immediately.
 */
const PROGRESS_SYNC_STEP_S = 0.25;

/**
 * Wraps a media-element handler so only the element that is playing drives the
 * player. The standby element buffers the next track in silence; its events
 * (and the pause/emptied burst when it hands over) must not move the UI.
 */
const fromActive =
  (handler: (el: HTMLAudioElement) => void) =>
  (event: SyntheticEvent<HTMLAudioElement>) => {
    if (event.currentTarget === musicAudioEngine.getActiveElement()) handler(event.currentTarget);
  };

export function GlobalMusicAudio() {
  const firstRef = useRef<HTMLAudioElement | null>(null);
  const secondRef = useRef<HTMLAudioElement | null>(null);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);

  // --- watch-history persistence ---
  const historyTrackRef = useRef<SongItem | null>(null);
  const lastProgressRef = useRef({ time: 0, duration: 0 });
  const lastPersistAtRef = useRef(0);

  useEffect(() => {
    const first = firstRef.current;
    const second = secondRef.current;
    if (!first || !second) return;
    musicAudioEngine.attach([first, second]);
    const s = useMusicPlayerStore.getState();
    musicAudioEngine.setVolume(s.volume);
    musicAudioEngine.setMuted(s.isMuted);
    musicAudioEngine.setEqEnabled(s.eqEnabled);
    musicAudioEngine.setEqGains(s.eqGains);
  }, []);

  useEffect(() => {
    if (currentTrack) {
      historyTrackRef.current = currentTrack;
      lastProgressRef.current = { time: 0, duration: currentTrack.duration ?? 0 };
      lastPersistAtRef.current = Date.now();
      void recordSongHistory(currentTrack, 0, currentTrack.duration ?? 0);
    }
    return () => {
      const prev = historyTrackRef.current;
      if (prev) {
        const { time, duration } = lastProgressRef.current;
        void recordSongHistory(prev, time, duration);
      }
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    const handler = () => {
      const t = historyTrackRef.current;
      if (!t) return;
      const { time, duration } = lastProgressRef.current;
      void recordSongHistory(t, time, duration);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let lastSyncedTime = -1;
    let lastSyncedDuration = -1;
    const tick = () => {
      const el = musicAudioEngine.getActiveElement();
      if (el) {
        const duration = Number.isFinite(el.duration)
          ? el.duration
          : lastProgressRef.current.duration;

        /*
          A store write notifies every subscriber, so each one costs a selector
          run across the whole music UI — and MusicItemCard holds six of them per
          card. At 60 Hz that was tens of thousands of evaluations a second to
          move a progress bar by a fraction of a pixel. The only consumer of
          `progress` is MusicScrubber, whose bar and second-granularity time
          readout cannot show more than this; the lyrics canvas reads the audio
          engine directly and keeps full frame accuracy.
        */
        if (
          Math.abs(el.currentTime - lastSyncedTime) >= PROGRESS_SYNC_STEP_S ||
          duration !== lastSyncedDuration
        ) {
          lastSyncedTime = el.currentTime;
          lastSyncedDuration = duration;
          useMusicPlayerStore.getState()._syncTime(el.currentTime, el.duration);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const store = () => useMusicPlayerStore.getState();

    if (currentTrack) {
      const artwork = upgradeMusicImageUrl(currentTrack.thumbnail, 512);
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artists.map((a) => a.name).join(", "),
          album: currentTrack.album?.name ?? "",
          artwork: artwork
            ? [{ src: artwork, sizes: "512x512", type: "image/jpeg" }]
            : [],
        });
      } catch {
      }
    }

    navigator.mediaSession.setActionHandler("play", () => store().play());
    navigator.mediaSession.setActionHandler("pause", () => store().pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => store().previous());
    navigator.mediaSession.setActionHandler("nexttrack", () => store().next());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") store().seek(details.seekTime);
    });
  }, [currentTrack]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying]);

  const store = () => useMusicPlayerStore.getState();
  const audioProps = {
    hidden: true,
    preload: "auto",
    onPlay: fromActive(() => store()._reflectPlaying(true)),
    onPause: fromActive(() => store()._reflectPlaying(false)),
    onWaiting: fromActive(() => store()._setBuffering(true)),
    onPlaying: fromActive(() => store()._setBuffering(false)),
    onDurationChange: fromActive((el) => store()._syncTime(el.currentTime, el.duration)),
    // Near the end, buffer the next track on the standby element so the change
    // is a swap. Driven by the element rather than the frame loop, which WebKit
    // pauses while the window is hidden, as it usually is while music plays.
    // The listed length stands in when WebKit reports a stream as endless.
    onTimeUpdate: fromActive((el) => {
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : store().duration;
      if (duration > 0 && duration - el.currentTime <= PRELOAD_LEAD_SECONDS) store()._preloadUpcoming();

      // History is persisted from here for the same reason: the frame loop
      // stops in the background, and listening there is the common case.
      lastProgressRef.current = { time: el.currentTime, duration };
      const now = Date.now();
      if (now - lastPersistAtRef.current > HISTORY_PERSIST_MS) {
        lastPersistAtRef.current = now;
        const t = historyTrackRef.current;
        if (t) void recordSongHistory(t, el.currentTime, duration);
      }
    }),
    onEnded: fromActive(() => store().handleEnded()),
    onError: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget === musicAudioEngine.getActiveElement()) store()._onPlaybackError();
      else store()._onPreloadError();
    },
  } as const;

  return (
    <>
      <audio ref={firstRef} {...audioProps} />
      <audio ref={secondRef} {...audioProps} />
    </>
  );
}
