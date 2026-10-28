import { usePlayerStore, type PlayerState } from "../../store/usePlayerStore";
import { activeTab, useTabsStore, type ParkedVideo } from "../../store/useTabsStore";
import { currentEntry, type TabHistory } from "./tabHistory";
import { neighborTab } from "./tabList";
import { watchVideoIdFromPath } from "../watchRouteSync";

/*
  A window has one player and any number of tabs. The tab that started the
  video owns it; when another tab starts a different one, the owner's video is
  parked with its position and resumes when that tab comes back.
*/

function tabWatchId(tab: TabHistory | undefined): string | null {
  return tab ? watchVideoIdFromPath(currentEntry(tab).pathname) : null;
}

function snapshot(player: Pick<PlayerState, "currentVideo" | "currentTime" | "queue" | "currentIndex" | "playlistContext">): ParkedVideo | null {
  if (!player.currentVideo) return null;
  return {
    videoId: player.currentVideo.id,
    positionSeconds: player.currentTime,
    queue: player.queue.length > 0 ? player.queue : [player.currentVideo],
    currentIndex: player.queue.length > 0 ? Math.max(0, player.currentIndex) : 0,
    playlistContext: player.playlistContext,
  };
}

function resume(video: ParkedVideo): void {
  const player = usePlayerStore.getState();
  player.setQueue(video.queue, video.currentIndex, video.playlistContext);
  player.setPipHandoff(video.videoId, video.positionSeconds, true);
}

/** Switches tabs, handing the player to the target tab when it holds a parked video. */
export function switchToTab(id: string): void {
  const tabs = useTabsStore.getState();
  if (id === tabs.activeId) return;
  const target = tabs.tabs.find((tab) => tab.id === id);
  if (!target) return;

  const parked = tabs.parked[id];
  if (parked && tabWatchId(target) === parked.videoId) {
    const owner = tabs.playerTabId;
    const current = snapshot(usePlayerStore.getState());
    if (owner && owner !== id && current) tabs.park(owner, current);
    tabs.unpark(id);
    resume(parked);
    tabs.setPlayerTab(id);
  }
  tabs.activateTab(id);
}

export function closeTabWithPlayback(id: string): void {
  const tabs = useTabsStore.getState();
  const neighbor = neighborTab(tabs.tabs, id);
  if (!neighbor) return;
  if (tabs.playerTabId === id) usePlayerStore.getState().dismissVideoPlayer();
  if (tabs.activeId === id) switchToTab(neighbor.id);
  useTabsStore.getState().closeTab(id);
}

/** Opens the player's video full size, in the tab it belongs to. */
export function expandPlayerInOwnerTab(): boolean {
  const tabs = useTabsStore.getState();
  const owner = tabs.playerTabId;
  const videoId = usePlayerStore.getState().currentVideo?.id;
  if (!owner || owner === tabs.activeId || !videoId) return false;
  switchToTab(owner);
  const ownerTab = useTabsStore.getState().tabs.find((tab) => tab.id === owner);
  if (tabWatchId(ownerTab) !== videoId) useTabsStore.getState().push(`/watch/${videoId}`);
  usePlayerStore.getState().expandVideoPlayer();
  return true;
}

/**
 * Keeps track of which tab owns the player as its video changes. A change made
 * while you look at another tab is either you opening a video there (that tab
 * then shows `/watch/<new>`, and the old video parks in its tab) or the owner's
 * queue moving on in the mini player (the owner's page follows it). The route
 * is only known once the click handler has also navigated, hence the microtask.
 */
export function installTabPlaybackSync(): () => void {
  return usePlayerStore.subscribe((state, previous) => {
    const nextId = state.currentVideo?.id ?? null;
    const previousId = previous.currentVideo?.id ?? null;
    if (nextId === previousId) return;

    const tabs = useTabsStore.getState();
    const owner = tabs.playerTabId;
    if (!nextId) {
      tabs.setPlayerTab(null);
      return;
    }
    if (!previousId || !owner || !tabs.tabs.some((tab) => tab.id === owner)) {
      tabs.setPlayerTab(tabs.activeId);
      return;
    }
    if (owner === tabs.activeId) return;

    const parked = snapshot(previous);
    queueMicrotask(() => {
      const now = useTabsStore.getState();
      if (now.playerTabId !== owner) return;
      if (now.activeId !== owner && tabWatchId(activeTab(now)) === nextId) {
        if (parked) now.park(owner, parked);
        now.setPlayerTab(now.activeId);
        return;
      }
      const ownerTab = now.tabs.find((tab) => tab.id === owner);
      if (tabWatchId(ownerTab) === previousId) now.replaceInTab(owner, `/watch/${nextId}`);
    });
  });
}
