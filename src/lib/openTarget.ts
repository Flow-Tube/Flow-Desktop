import type { MouseEvent as ReactMouseEvent } from "react";
import { readStreamInfoEntry } from "./streamResolution";
import { wantsBackgroundTab } from "./clickIntent";
import { tabsEnabled } from "./tabs/tabsEnabled";
import { openAppWindow, type WindowVideoHandoff } from "./api/appWindow";
import { usePlayerStore } from "../store/usePlayerStore";
import { activeTab, useTabsStore, type ParkedVideo } from "../store/useTabsStore";
import { currentEntry } from "./tabs/tabHistory";
import { closeTabWithPlayback, playerSnapshot } from "./tabs/tabPlayback";
import { useUiStore } from "../store/useUiStore";
import { getString } from "./i18n/index";
import type { VideoSummary } from "../types/video";

/** The page a card opens: a Short in the Shorts player, a channel result on its channel page. */
export function routeForVideo(video: Pick<VideoSummary, "id" | "isShort">): string {
  if (video.id.startsWith("channel:")) return `/channel/${video.id.slice("channel:".length)}`;
  return video.isShort ? `/shorts/${video.id}` : `/watch/${video.id}`;
}

/** Opens `route` in a background tab; false, and nothing opened, while tabs are off. */
export function openInNewTab(route: string): boolean {
  if (!tabsEnabled()) return false;
  useTabsStore.getState().openTab(route);
  return true;
}

export async function openInNewWindow(route: string, handoff: WindowVideoHandoff | null = null): Promise<boolean> {
  try {
    await openAppWindow(route, handoff);
    return true;
  } catch (error) {
    console.error("Failed to open a new window", error);
    useUiStore.getState().showToast({ variant: "error", message: getString("window_open_failed") });
    return false;
  }
}

function handoffFor(video: ParkedVideo, playing: boolean): WindowVideoHandoff {
  const stream = readStreamInfoEntry(video.videoId);
  return {
    queue: video.queue,
    currentIndex: video.currentIndex,
    playlistContext: video.playlistContext,
    positionSeconds: video.positionSeconds,
    playing,
    stream: stream ? { info: stream.info, resolvedAt: stream.resolvedAt } : null,
  };
}

/**
 * Moves the playing video into a new window, picking up at the same second,
 * and takes this tab back to the page before it.
 */
export async function moveVideoToNewWindow(): Promise<void> {
  const player = usePlayerStore.getState();
  const video = playerSnapshot(player);
  if (!video) return;
  if (!(await openInNewWindow(`/watch/${video.videoId}`, handoffFor(video, player.isPlaying)))) return;

  usePlayerStore.getState().dismissVideoPlayer();
  const tabs = useTabsStore.getState();
  if (activeTab(tabs).index > 0) tabs.go(-1);
  else tabs.replace("/");
}

/** Opens a tab's page in a new window, bringing its video along, and closes the tab here. */
export async function moveTabToNewWindow(tabId: string): Promise<void> {
  const tabs = useTabsStore.getState();
  const tab = tabs.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) return;
  const page = currentEntry(tab);
  const route = page.pathname + page.search + page.hash;
  const player = usePlayerStore.getState();
  const owned = tabs.playerTabId === tabId ? playerSnapshot(player) : null;
  const video = owned ?? tabs.parked[tabId] ?? null;
  const handoff = video && route.startsWith(`/watch/${video.videoId}`) ? handoffFor(video, owned ? player.isPlaying : false) : null;
  if (!(await openInNewWindow(route, handoff))) return;

  if (useTabsStore.getState().tabs.length > 1) {
    closeTabWithPlayback(tabId);
    return;
  }
  // The window's last tab stays, back on Home.
  if (owned) usePlayerStore.getState().dismissVideoPlayer();
  useTabsStore.getState().unpark(tabId);
  useTabsStore.getState().push("/");
}

/**
 * Middle-click on a card opens its page in a background tab. Pressing the
 * middle button would otherwise start the webview's autoscroll.
 */
export function backgroundTabClickProps(route: string) {
  return {
    onMouseDown: (event: ReactMouseEvent) => {
      if (event.button === 1 && tabsEnabled()) event.preventDefault();
    },
    onAuxClick: (event: ReactMouseEvent) => {
      if (event.button !== 1 || !openInNewTab(route)) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** For a card's click handler: true when the click asked for a background tab and got one. */
export function openedInBackgroundTab(event: ReactMouseEvent | undefined, route: string): boolean {
  if (!event || !wantsBackgroundTab(event) || !openInNewTab(route)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
