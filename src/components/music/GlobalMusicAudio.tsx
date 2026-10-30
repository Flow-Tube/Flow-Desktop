import { useEffect, useRef, type SyntheticEvent } from "react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { musicAudioEngine } from "../../lib/audio/musicAudioEngine";
import { bindMusicAudioSettings } from "../../lib/audio/musicAudioSettings";
import { PRELOAD_LEAD_SECONDS } from "../../lib/musicPreload";
import { useMusicMediaSession } from "../../lib/useMusicMediaSession";
import { reportMediaPosition } from "../../lib/mediaSessionArbiter";
import { musicListens, useMusicListenHistory } from "../../lib/useMusicListenHistory";
import { useMusicQueuePersistence } from "../../lib/useMusicQueuePersistence";
import { sleepTimerTakesEnd, tickSleepTimer, useSleepTimerDriver } from "../../lib/useSleepTimerDriver";
import { useLyricsLookup } from "../../lib/lyrics/useLyrics";

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

  const generation = useMusicPlayerStore((s) => s.audioGeneration);
  useEffect(() => {
    const first = firstRef.current;
    const second = secondRef.current;
    if (!first || !second) return;
    musicAudioEngine.attach([first, second]);
    const s = useMusicPlayerStore.getState();
    musicAudioEngine.setVolume(s.volume);
    musicAudioEngine.setMuted(s.isMuted);
    bindMusicAudioSettings();
  }, [generation]);

  useMusicListenHistory();
  useMusicQueuePersistence();
  useSleepTimerDriver();
  useMusicMediaSession();
  useLyricsLookup();

  const store = () => useMusicPlayerStore.getState();
  const finishTrack = () => {
    musicListens.finish(Date.now());
    if (sleepTimerTakesEnd()) return;
    store().handleEnded();
  };
  // The engine corrects a length WebKit reports wrong, so the player reads it there.
  const syncTime = (el: HTMLAudioElement) => store()._syncTime(el.currentTime, musicAudioEngine.getDuration());
  const audioProps = {
    hidden: true,
    preload: "auto",
    onPlay: fromActive(() => store()._reflectPlaying(true)),
    onPause: fromActive(() => {
      musicListens.pause();
      store()._reflectPlaying(false);
    }),
    onWaiting: fromActive(() => {
      musicListens.hold();
      store()._setBuffering(true);
    }),
    onPlaying: fromActive(() => store()._setBuffering(false)),
    onDurationChange: fromActive(syncTime),
    onSeeked: fromActive(syncTime),
    // Near the end, buffer the next track on the standby element so the change
    // is a swap. Driven by the element rather than the frame loop, which WebKit
    // pauses while the window is hidden, as it usually is while music plays.
    // The listed length stands in when WebKit reports a stream as endless.
    onTimeUpdate: fromActive((el) => {
      // A song whose element reports twice its length ends at the listed one, not after the
      // silence the element would play to reach its own.
      if (musicAudioEngine.takeListedEnd()) {
        finishTrack();
        return;
      }
      const duration = musicAudioEngine.getDuration() || store().duration;
      if (duration > 0 && duration - el.currentTime <= PRELOAD_LEAD_SECONDS) store()._preloadUpcoming();

      /*
        The store's clock follows this event instead of a frame loop, and
        `_syncTime` publishes it only when the whole second changes. A store
        write notifies every subscriber, so each one costs a selector run
        across the whole music UI, and MusicItemCard holds six of them per
        card. Anything that needs the exact position (the full player's seek
        bar, the lyrics) reads the audio engine directly.
      */
      syncTime(el);
      reportMediaPosition("music");
      tickSleepTimer();

      // Listening time is counted from here for the same reason: a frame loop
      // stops in the background, and listening there is the common case.
      // While the next song resolves, the element still plays the last one,
      // which must not count toward the new song.
      const { currentTrack, loadingStreamId } = store();
      if (currentTrack && !el.paused && loadingStreamId === null) {
        musicListens.tick(currentTrack, el.currentTime, duration, Date.now());
      } else {
        musicListens.hold();
      }
    }),
    onEnded: fromActive(finishTrack),
    onError: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget === musicAudioEngine.getActiveElement()) store()._onPlaybackError();
      else store()._onPreloadError();
    },
  } as const;

  return (
    <>
      <audio key={`first-${generation}`} ref={firstRef} {...audioProps} />
      <audio key={`second-${generation}`} ref={secondRef} {...audioProps} />
    </>
  );
}
