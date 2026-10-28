import { create } from "zustand";
import { NavigationType, type To } from "react-router-dom";
import {
  createEntry,
  goInTab,
  pushEntry,
  replaceEntry,
  type TabHistory,
} from "../lib/tabs/tabHistory";

interface TabsState {
  tabs: TabHistory[];
  activeId: string;
  /** How the active tab's current page was reached, for the router's navigation type. */
  action: NavigationType;
  push: (to: To, state?: unknown) => void;
  replace: (to: To, state?: unknown) => void;
  go: (delta: number) => void;
}

function initialTab(): TabHistory {
  const { pathname, search, hash } = typeof window === "undefined"
    ? { pathname: "/", search: "", hash: "" }
    : window.location;
  return { id: "tab-1", entries: [createEntry({ pathname, search, hash })], index: 0 };
}

export function activeTab(state: Pick<TabsState, "tabs" | "activeId">): TabHistory {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeId) ?? state.tabs[0];
  if (!tab) throw new Error("A window always has at least one tab");
  return tab;
}

function updateActive(state: TabsState, next: TabHistory): Pick<TabsState, "tabs"> {
  return { tabs: state.tabs.map((tab) => (tab.id === next.id ? next : tab)) };
}

const firstTab = initialTab();

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [firstTab],
  activeId: firstTab.id,
  action: NavigationType.Pop,

  push: (to, state) => {
    const current = get();
    set({ ...updateActive(current, pushEntry(activeTab(current), createEntry(to, state))), action: NavigationType.Push });
  },

  replace: (to, state) => {
    const current = get();
    set({ ...updateActive(current, replaceEntry(activeTab(current), createEntry(to, state))), action: NavigationType.Replace });
  },

  go: (delta) => {
    const current = get();
    const next = goInTab(activeTab(current), delta);
    if (next) set({ ...updateActive(current, next), action: NavigationType.Pop });
  },
}));
