import { useEffect } from "react";

import { applyMusicKeyAction } from "./musicKeyActions";
import { musicDockKeyAction } from "./musicPlayerKeys";
import { keyBelongsToTarget } from "./shortcuts/target";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * Music keys while only the music bar shows. A video in the player keeps its own keys, which are the
 * same letters, so the bar stays quiet while one is loaded. Shorts take their keys before these.
 */
export function useMusicDockKeyboard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || keyBelongsToTarget(event.target, event.key)) return;
      if (usePlayerStore.getState().currentVideo) return;
      const action = musicDockKeyAction(event);
      if (!action) return;
      event.preventDefault();
      applyMusicKeyAction(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
