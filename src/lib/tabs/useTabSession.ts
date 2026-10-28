import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../api/db";
import { SETTINGS } from "../settings/schema";
import { usePlayerStore } from "../../store/usePlayerStore";
import { activeTab, useTabsStore } from "../../store/useTabsStore";
import { readSavedWatchProgress } from "../useVideoStream";
import { createEntry, currentEntry, type TabHistory } from "./tabHistory";
import { createTabId } from "./tabList";
import { IS_MAIN_WINDOW } from "../appWindow";
import { takeAppWindowSession } from "../api/appWindow";
import { primeStreamInfo } from "../streamResolution";
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

/** An extra window starts on the page it was opened for, with a moved video picking up where it was. */
async function bootExtraWindow(): Promise<void> {
  const session = await takeAppWindowSession().catch(() => null);
  if (!session) return;
  const tab: TabHistory = { id: createTabId(), entries: [createEntry(session.route)], index: 0 };
  useTabsStore.getState().restoreTabs({ tabs: [tab], activeId: tab.id, parked: {}, titles: {} });

  const handoff = session.handoff;
  const video = handoff?.queue[handoff.currentIndex];
  if (!handoff || !video) return;
  if (handoff.stream) primeStreamInfo(video.id, handoff.stream.info, handoff.stream.resolvedAt);
  const player = usePlayerStore.getState();
  player.setQueue(handoff.queue, handoff.currentIndex, handoff.playlistContext);
  player.setPipHandoff(video.id, handoff.positionSeconds, handoff.playing);
  useTabsStore.getState().setPlayerTab(tab.id);
}

/**
 * Brings back the main window's tabs from the last run, then keeps saving
 * them; an extra window instead opens on the page it was given. Nothing starts
 * playing on restore: a video page opens paused where it was left. Returns
 * false until the tabs are in place, so no page loads twice.
 */
export function useTabSession(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!IS_MAIN_WINDOW) {
      void bootExtraWindow().finally(() => setReady(true));
      return;
    }
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
    if (!ready || !IS_MAIN_WINDOW) return;
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
