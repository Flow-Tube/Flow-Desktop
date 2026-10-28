import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useTabsStore } from "../../store/useTabsStore";
import { useResolvedWindowTitle } from "../useResolvedWindowTitle";

/** Files the window title under the active tab's current page, for its row in the rail. */
export function useActiveTabTitle(): void {
  const { text } = useResolvedWindowTitle();
  const { key } = useLocation();
  // The full-screen music player takes over the window title; that is not the page's name.
  const musicOverlayOpen = useMusicPlayerStore((s) => s.currentTrack !== null && s.viewState !== "dock");

  useEffect(() => {
    if (!text || musicOverlayOpen) return;
    const { activeId, setTabTitle } = useTabsStore.getState();
    setTabTitle(activeId, key, text);
  }, [text, key, musicOverlayOpen]);
}
