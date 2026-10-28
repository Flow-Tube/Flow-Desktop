import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../api/db";
import { SETTINGS } from "../settings/schema";
import { usePlayerStore } from "../../store/usePlayerStore";
import { activeTab, useTabsStore } from "../../store/useTabsStore";
import { readSavedWatchProgress } from "../useVideoStream";
import { currentEntry } from "./tabHistory";
import { parseTabSession, restoreTabSession, serializeTabSession } from "./tabSession";
import { playerSnapshot } from "./tabPlayback";
import { watchVideoIdFromPath } from "../watchRouteSync";

const SAVE_DELAY_MS = 1_000;

function save(): void {
  const tabs = useTabsStore.getState();
  const player = usePlayerStore.getState();
  const video = playerSnapshot(player);
  const titles: Record<string, string> = {};
  for (const tab of tabs.tabs) {
    const title = tabs.titles[tab.id];
    if (title && title.key === currentEntry(tab).key) titles[tab.id] = title.text;
  }
  const session = serializeTabSession({
    tabs: tabs.tabs,
    activeId: tabs.activeId,
    parked: tabs.parked,
    titles,
    playing: tabs.playerTabId && video ? { tabId: tabs.playerTabId, video } : null,
  });
  void setSetting(SETTINGS.TAB_SESSION, JSON.stringify(session)).catch((error) =>
    console.warn("Failed to save open tabs", error),
  );
}

/**
 * Brings back the tabs from the last run, then keeps saving them. Nothing
 * starts playing: a restored video page opens paused where it was left.
 * Returns false until the saved tabs are in place, so no page loads twice.
 */
export function useTabSession(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSetting(SETTINGS.TAB_SESSION)
      .catch(() => null)
      .then((raw) => {
        if (cancelled) return;
        const session = parseTabSession(raw);
        if (session) {
          const tabs = useTabsStore.getState();
          tabs.restoreTabs(restoreTabSession(session));
          const restored = useTabsStore.getState();
          const front = activeTab(restored);
          const parked = restored.parked[front.id];
          if (parked && watchVideoIdFromPath(currentEntry(front).pathname) === parked.videoId) {
            const player = usePlayerStore.getState();
            const position = readSavedWatchProgress(parked.videoId) || parked.positionSeconds;
            player.setQueue(parked.queue, parked.currentIndex, parked.playlistContext);
            player.setPipHandoff(parked.videoId, position, false);
            restored.unpark(front.id);
            restored.setPlayerTab(front.id);
          }
        }
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_DELAY_MS);
    };
    const unsubscribeTabs = useTabsStore.subscribe(schedule);
    const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
      if (state.currentVideo?.id !== previous.currentVideo?.id || state.isPlaying !== previous.isPlaying) schedule();
    });
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      unsubscribeTabs();
      unsubscribePlayer();
      window.removeEventListener("pagehide", save);
    };
  }, [ready]);

  return ready;
}
