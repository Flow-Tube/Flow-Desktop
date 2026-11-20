import { useEffect } from "react";
import { useTabsStore } from "../../store/useTabsStore";
import { historyDeltaForMouseButton } from "./historyShortcuts";

/** The mouse's Back and Forward side buttons. Their keys live with the other app keys in useAppShortcuts. */
export function useTabHistoryMouseButtons(): void {
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      const delta = historyDeltaForMouseButton(event.button);
      if (delta === null) return;
      event.preventDefault();
      useTabsStore.getState().go(delta);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);
}
