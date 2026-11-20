import { useEffect } from "react";

import { applyMusicKeyAction } from "./musicKeyActions";
import { musicPlayerKeyAction } from "./musicPlayerKeys";
import { keyBelongsToTarget } from "./shortcuts/target";
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
      applyMusicKeyAction(action);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEscapeKey);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEscapeKey);
    };
  }, [enabled, onEscape, seekSeconds]);
}
