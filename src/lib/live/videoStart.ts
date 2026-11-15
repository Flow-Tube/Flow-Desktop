import type { StoreApi } from "zustand";

import type { PlayerState } from "../../store/usePlayerStore";

/** How long a video handed here gets to start before the handoff is answered as failed, as on Android. */
export const VIDEO_START_WITHIN_MS = 20_000;

type Started = Pick<PlayerState, "currentVideo" | "playbackStartedVideoId" | "duration">;

/** A video handed over playing has started once it renders; one handed over paused, once its media loaded. */
export function videoStarted(state: Started, video: string, playing: boolean): boolean {
  if (playing) return state.playbackStartedVideoId === video;
  return state.currentVideo?.id === video && state.duration > 0;
}

/** Resolves once `video` started in `store`; rejects when it hasn't within `withinMs`. */
export function whenVideoStarts(
  store: Pick<StoreApi<Started>, "getState" | "subscribe">,
  video: string,
  playing: boolean,
  withinMs = VIDEO_START_WITHIN_MS,
): Promise<void> {
  if (videoStarted(store.getState(), video, playing)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("unavailable"));
    }, withinMs);
    const stop = store.subscribe((state) => {
      if (!videoStarted(state, video, playing)) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}
