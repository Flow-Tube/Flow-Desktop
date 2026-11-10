import { useEffect } from "react";

import { useDownloadStore } from "../store/useDownloadStore";
import { useTabsStore } from "../store/useTabsStore";
import type { DownloadProgress } from "./api/downloads";
import { setDownloadProgressBadge, setShellPages, takeLaunchPage, type DownloadProgressBadge } from "./api/tray";
import { getString } from "./i18n/index";
import { FOCUS_SEARCH_EVENT } from "./windowEvents";

const SEARCH_ROUTE = "/search";

/** A page from the Dock menu or Jump List. Search has nothing to show until there is a query. */
export function openShellRoute(route: string): void {
  if (route === SEARCH_ROUTE) window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
  else useTabsStore.getState().push(route);
}

const RUNNING = new Set<DownloadProgress["status"]>(["queued", "downloading", "paused", "waitingForNetwork", "muxing"]);

/** Downloads in progress as one figure, with no percentage while any size is still unknown. */
export function downloadBadge(active: DownloadProgress[]): DownloadProgressBadge {
  const running = active.filter((item) => RUNNING.has(item.status));
  const sized = running.every((item) => item.totalBytes && item.totalBytes > 0);
  const total = running.reduce((sum, item) => sum + (item.totalBytes ?? 0), 0);
  const done = running.reduce((sum, item) => sum + item.downloadedBytes, 0);
  return {
    percent: running.length > 0 && sized ? Math.min(100, Math.floor((done / total) * 100)) : null,
    count: running.length,
    paused: running.length > 0 && running.every((item) => item.status === "paused"),
  };
}

/** Fills in the Dock menu or Jump List, opens the page a launch asked for, and keeps the icon's progress current. */
export function useShellPages(): void {
  useEffect(() => {
    void setShellPages({
      search: getString("shell_page_search"),
      downloads: getString("shell_page_downloads"),
      history: getString("shell_page_history"),
      music: getString("shell_page_music"),
    });
    void takeLaunchPage().then((route) => {
      if (route) openShellRoute(route);
    });
  }, []);

  useEffect(() => {
    let sent = "";
    const publish = (active: Record<string, DownloadProgress>) => {
      const badge = downloadBadge(Object.values(active));
      const key = JSON.stringify(badge);
      if (key === sent) return;
      sent = key;
      void setDownloadProgressBadge(badge);
    };
    publish(useDownloadStore.getState().active);
    return useDownloadStore.subscribe((state) => publish(state.active));
  }, []);
}
