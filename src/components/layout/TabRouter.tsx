import { useEffect, type ReactNode } from "react";
import { createPath, Router, type Navigator, type To } from "react-router-dom";
import { activeTab, useTabsStore } from "../../store/useTabsStore";
import { currentEntry } from "../../lib/tabs/tabHistory";
import { IS_MAIN_WINDOW } from "../../lib/appWindow";
import { openRouteInMainWindow } from "../../lib/api/appWindow";
import { isMusicRoute } from "../../lib/musicRoutes";

/*
  Each tab keeps its own back/forward list, so the router cannot sit on the
  webview's single history the way BrowserRouter does: Back would walk into
  whatever another tab showed. Navigation goes to the active tab instead.
*/
const toPath = (to: To) => (typeof to === "string" ? to : createPath(to));

/** Music plays only in the main window, so its pages open there too. */
function opensInMainWindow(to: To): boolean {
  if (IS_MAIN_WINDOW) return false;
  const path = toPath(to);
  if (!isMusicRoute(path)) return false;
  void openRouteInMainWindow(path).catch(() => {});
  return true;
}

const tabNavigator: Navigator = {
  createHref: toPath,
  push: (to, state) => {
    if (!opensInMainWindow(to)) useTabsStore.getState().push(to, state);
  },
  replace: (to, state) => {
    if (!opensInMainWindow(to)) useTabsStore.getState().replace(to, state);
  },
  go: (delta) => useTabsStore.getState().go(delta),
};

export function TabRouter({ children }: { children: ReactNode }) {
  const entry = useTabsStore((state) => currentEntry(activeTab(state)));
  const action = useTabsStore((state) => state.action);

  // Mirrored only so a reload (the crash recovery path included) reopens the same page.
  useEffect(() => {
    window.history.replaceState(null, "", createPath(entry));
  }, [entry]);

  return (
    <Router location={entry} navigationType={action} navigator={tabNavigator}>
      {children}
    </Router>
  );
}
