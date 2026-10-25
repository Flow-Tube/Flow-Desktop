import { useEffect } from "react";

import { musicAudioEngine } from "./audio/musicAudioEngine";
import { keyBelongsToTarget, musicPlayerKeyAction } from "./musicPlayerKeys";
import { SETTINGS } from "./settings/schema";
import { useNumberPref } from "./usePreference";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";

/**
 * The full player's keys, while it is open. Media keys are taken in the capture
 * phase and stopped there, so a video page mounted under the player never acts
 * on the same key. Escape is layered instead: menus claim it on the way up,
 * then anything open inside the player gets it through `onEscape`, and only an
 * Escape nothing else took closes the player.
 */
export function useMusicPlayerKeyboard(enabled: boolean, onEscape: () => boolean): void {
  const [seekSeconds] = useNumberPref(SETTINGS.DOUBLE_TAP_SEEK_SECONDS);

  useEffect(() => {
    if (!enabled) return;
    const onEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (!onEscape()) useMusicPlayerStore.getState().closeOverlay();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || keyBelongsToTarget(event.target, event.key)) return;
      const action = musicPlayerKeyAction(event, seekSeconds);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      const store = useMusicPlayerStore.getState();
      const position = musicAudioEngine.getCurrentTime();
      switch (action.kind) {
        case "toggle-play":
          store.togglePlay();
          break;
        case "seek-by":
          store.seek(Math.min(Math.max(0, position + action.seconds), Math.max(0, store.duration - 1)));
          break;
        case "seek-to-fraction":
          if (store.duration > 0) store.seek(store.duration * action.fraction);
          break;
        case "volume-by":
          store.setVolume(Math.min(1, Math.max(0, store.volume + action.delta)));
          break;
        case "toggle-mute":
          store.toggleMute();
          break;
        case "next":
          store.next();
          break;
        case "previous":
          store.previous();
          break;
        case "toggle-shuffle":
          store.toggleShuffle();
          break;
        case "cycle-repeat":
          store.cycleRepeat();
          break;
        case "toggle-queue":
          store.setViewState(store.viewState === "queue" ? "full" : "queue");
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEscapeKey);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEscapeKey);
    };
  }, [enabled, onEscape, seekSeconds]);
}
