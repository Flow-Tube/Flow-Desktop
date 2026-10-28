import { useEffect } from "react";
import { useTabsStore } from "../../store/useTabsStore";
import { keyBelongsToTarget } from "../musicPlayerKeys";
import { IS_MACOS_RUNTIME } from "../platform";
import { historyDeltaForKey, historyDeltaForMouseButton } from "./historyShortcuts";

export function useTabHistoryShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || keyBelongsToTarget(event.target, event.key)) return;
      const delta = historyDeltaForKey(event, IS_MACOS_RUNTIME);
      if (delta === null) return;
      event.preventDefault();
      useTabsStore.getState().go(delta);
    };
    const onMouseUp = (event: MouseEvent) => {
      const delta = historyDeltaForMouseButton(event.button);
      if (delta === null) return;
      event.preventDefault();
      useTabsStore.getState().go(delta);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}
