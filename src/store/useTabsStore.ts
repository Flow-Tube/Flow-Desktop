import { create } from "zustand";
import { NavigationType, type To } from "react-router-dom";
import {
  createEntry,
  createEntryKey,
  goInTab,
  pushEntry,
  replaceEntry,
  type TabHistory,
} from "../lib/tabs/tabHistory";
import { createTabId, insertTabAfter, neighborTab } from "../lib/tabs/tabList";
import type { PlaylistContext } from "./usePlayerStore";
import type { VideoSummary } from "../types/video";

/** A video a tab was showing when another tab took the player, kept so it can resume there. */
export interface ParkedVideo {
  videoId: string;
  positionSeconds: number;
  queue: VideoSummary[];
  currentIndex: number;
  playlistContext: PlaylistContext | null;
}

/** A tab's title, tied to the page it was read from so a stale one is never shown. */
export interface TabTitle {
  key: string;
  text: string;
}

interface TabsState {
  tabs: TabHistory[];
  activeId: string;
  /** How the active tab's current page was reached, for the router's navigation type. */
  action: NavigationType;
  /** Whether the last route change came from switching tabs rather than navigating in one. */
  cause: "history" | "tab";
  /** The tab whose video is in the window's player. */
  playerTabId: string | null;
  parked: Record<string, ParkedVideo>;
  titles: Record<string, TabTitle>;
  push: (to: To, state?: unknown) => void;
  replace: (to: To, state?: unknown) => void;
  go: (delta: number) => void;
  /** Replaces the current page of any tab, active or not. */
  replaceInTab: (id: string, to: To) => void;
  openTab: (to: To, options?: { activate?: boolean }) => string;
  /** A copy of the tab's back/forward list, opened in the background after it. */
  duplicateTab: (id: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Drops every other tab; a video still in the player then belongs to this one. */
  keepOnlyTab: (id: string) => void;
  setPlayerTab: (id: string | null) => void;
  park: (id: string, video: ParkedVideo) => void;
  unpark: (id: string) => void;
  setTabTitle: (id: string, key: string, text: string) => void;
  restoreTabs: (restored: Pick<TabsState, "tabs" | "activeId" | "parked" | "titles">) => void;
}

function initialTab(): TabHistory {
  const { pathname, search, hash } = typeof window === "undefined"
    ? { pathname: "/", search: "", hash: "" }
    : window.location;
  return { id: createTabId(), entries: [createEntry({ pathname, search, hash })], index: 0 };
}

export function activeTab(state: Pick<TabsState, "tabs" | "activeId">): TabHistory {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeId) ?? state.tabs[0];
  if (!tab) throw new Error("A window always has at least one tab");
  return tab;
}

function updateTab(state: TabsState, next: TabHistory): Pick<TabsState, "tabs"> {
  return { tabs: state.tabs.map((tab) => (tab.id === next.id ? next : tab)) };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

const firstTab = initialTab();

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [firstTab],
  activeId: firstTab.id,
  action: NavigationType.Pop,
  cause: "history",
  playerTabId: null,
  parked: {},
  titles: {},

  push: (to, state) => {
    const current = get();
    set({
      ...updateTab(current, pushEntry(activeTab(current), createEntry(to, state))),
      action: NavigationType.Push,
      cause: "history",
    });
  },

  replace: (to, state) => {
    const current = get();
    set({
      ...updateTab(current, replaceEntry(activeTab(current), createEntry(to, state))),
      action: NavigationType.Replace,
      cause: "history",
    });
  },

  go: (delta) => {
    const current = get();
    const next = goInTab(activeTab(current), delta);
    if (next) set({ ...updateTab(current, next), action: NavigationType.Pop, cause: "history" });
  },

  replaceInTab: (id, to) => {
    const current = get();
    const tab = current.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (id === current.activeId) {
      current.replace(to);
      return;
    }
    set(updateTab(current, replaceEntry(tab, createEntry(to))));
  },

  openTab: (to, options) => {
    const current = get();
    const tab: TabHistory = { id: createTabId(), entries: [createEntry(to)], index: 0 };
    set({
      tabs: insertTabAfter(current.tabs, current.activeId, tab),
      ...(options?.activate ? { activeId: tab.id, action: NavigationType.Push, cause: "tab" as const } : {}),
    });
    return tab.id;
  },

  duplicateTab: (id) => {
    const current = get();
    const source = current.tabs.find((tab) => tab.id === id);
    if (!source) return;
    const copy: TabHistory = {
      id: createTabId(),
      entries: source.entries.map((entry) => ({ ...entry, key: createEntryKey() })),
      index: source.index,
    };
    const title = current.titles[id];
    const copiedKey = copy.entries[copy.index]?.key;
    set({
      tabs: insertTabAfter(current.tabs, id, copy),
      ...(title && copiedKey ? { titles: { ...current.titles, [copy.id]: { key: copiedKey, text: title.text } } } : {}),
    });
  },

  activateTab: (id) => {
    const current = get();
    if (id === current.activeId || !current.tabs.some((tab) => tab.id === id)) return;
    set({ activeId: id, action: NavigationType.Pop, cause: "tab" });
  },

  closeTab: (id) => {
    const current = get();
    const neighbor = neighborTab(current.tabs, id);
    if (!neighbor) return;
    set({
      tabs: current.tabs.filter((tab) => tab.id !== id),
      parked: withoutKey(current.parked, id),
      titles: withoutKey(current.titles, id),
      playerTabId: current.playerTabId === id ? null : current.playerTabId,
      ...(current.activeId === id ? { activeId: neighbor.id, action: NavigationType.Pop, cause: "tab" as const } : {}),
    });
  },

  keepOnlyTab: (id) => {
    const current = get();
    const tab = current.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const title = current.titles[id];
    set({
      tabs: [tab],
      activeId: id,
      parked: {},
      titles: title ? { [id]: title } : {},
      playerTabId: current.playerTabId ? id : null,
    });
  },

  setPlayerTab: (id) => set({ playerTabId: id }),
  park: (id, video) => set((current) => ({ parked: { ...current.parked, [id]: video } })),
  unpark: (id) => set((current) => ({ parked: withoutKey(current.parked, id) })),

  setTabTitle: (id, key, text) => {
    const title = get().titles[id];
    if (title?.key === key && title.text === text) return;
    set((current) => ({ titles: { ...current.titles, [id]: { key, text } } }));
  },

  restoreTabs: (restored) =>
    set({ ...restored, playerTabId: null, action: NavigationType.Pop, cause: "tab" }),
}));
