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

  useEffect(() => {
    const first = firstRef.current;
    const second = secondRef.current;
    if (!first || !second) return;
    musicAudioEngine.attach([first, second]);
    const s = useMusicPlayerStore.getState();
    musicAudioEngine.setVolume(s.volume);
    musicAudioEngine.setMuted(s.isMuted);
    bindMusicAudioSettings();
  }, []);

  useMusicListenHistory();
  useMusicQueuePersistence();
  useSleepTimerDriver();
  useMusicMediaSession();

  const store = () => useMusicPlayerStore.getState();
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
    onDurationChange: fromActive((el) => store()._syncTime(el.currentTime, el.duration)),
    onSeeked: fromActive((el) => store()._syncTime(el.currentTime, el.duration)),
    // Near the end, buffer the next track on the standby element so the change
    // is a swap. Driven by the element rather than the frame loop, which WebKit
    // pauses while the window is hidden, as it usually is while music plays.
    // The listed length stands in when WebKit reports a stream as endless.
    onTimeUpdate: fromActive((el) => {
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : store().duration;
      if (duration > 0 && duration - el.currentTime <= PRELOAD_LEAD_SECONDS) store()._preloadUpcoming();

      /*
        The store's clock follows this event instead of a frame loop, and
        `_syncTime` publishes it only when the whole second changes. A store
        write notifies every subscriber, so each one costs a selector run
        across the whole music UI, and MusicItemCard holds six of them per
        card. Anything that needs the exact position (the full player's seek
        bar, the lyrics) reads the audio engine directly.
      */
      store()._syncTime(el.currentTime, el.duration);
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
    onEnded: fromActive(() => {
      musicListens.finish(Date.now());
      if (sleepTimerTakesEnd()) return;
      store().handleEnded();
    }),
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
