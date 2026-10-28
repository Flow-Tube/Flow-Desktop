import { useEffect, type ReactNode } from "react";
import { createPath, Router, type Navigator } from "react-router-dom";
import { activeTab, useTabsStore } from "../../store/useTabsStore";
import { currentEntry } from "../../lib/tabs/tabHistory";

/*
  Each tab keeps its own back/forward list, so the router cannot sit on the
  webview's single history the way BrowserRouter does: Back would walk into
  whatever another tab showed. Navigation goes to the active tab instead.
*/
const tabNavigator: Navigator = {
  createHref: (to) => (typeof to === "string" ? to : createPath(to)),
  push: (to, state) => useTabsStore.getState().push(to, state),
  replace: (to, state) => useTabsStore.getState().replace(to, state),
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
