import type { ParkedVideo, TabTitle } from "../../store/useTabsStore";
import { createEntry, type TabHistory } from "./tabHistory";
import { createTabId } from "./tabList";

/** What the main window saves so its tabs come back on the next launch. */
export interface SavedTab {
  entries: Array<{ pathname: string; search: string; hash: string }>;
  index: number;
  title: string | null;
  parked: ParkedVideo | null;
}

export interface SavedTabSession {
  version: 1;
  active: number;
  tabs: SavedTab[];
}

export interface TabSessionInput {
  tabs: TabHistory[];
  activeId: string;
  parked: Record<string, ParkedVideo>;
  /** The title each tab shows now, already resolved for its current page. */
  titles: Record<string, string>;
  /** The video in the player, filed under the tab that owns it. */
  playing: { tabId: string; video: ParkedVideo } | null;
}

/** Route state is left out: it can hold anything, and pages work without it. */
export function serializeTabSession(input: TabSessionInput): SavedTabSession {
  return {
    version: 1,
    active: Math.max(0, input.tabs.findIndex((tab) => tab.id === input.activeId)),
    tabs: input.tabs.map((tab) => ({
      entries: tab.entries.map(({ pathname, search, hash }) => ({ pathname, search, hash })),
      index: tab.index,
      title: input.titles[tab.id] ?? null,
      parked: input.playing?.tabId === tab.id ? input.playing.video : input.parked[tab.id] ?? null,
    })),
  };
}

function isSavedTab(value: unknown): value is SavedTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as SavedTab;
  return (
    Array.isArray(tab.entries) &&
    tab.entries.length > 0 &&
    tab.entries.every((entry) => typeof entry?.pathname === "string" && entry.pathname.startsWith("/")) &&
    Number.isInteger(tab.index) &&
    tab.index >= 0 &&
    tab.index < tab.entries.length
  );
}

/** `null` for anything that is not a usable session, so a damaged value just starts fresh. */
export function parseTabSession(raw: string | null | undefined): SavedTabSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SavedTabSession;
    if (value?.version !== 1 || !Array.isArray(value.tabs)) return null;
    const tabs = value.tabs.filter(isSavedTab);
    if (tabs.length === 0) return null;
    const active = Number.isInteger(value.active) ? Math.min(Math.max(0, value.active), tabs.length - 1) : 0;
    return { version: 1, active, tabs };
  } catch {
    return null;
  }
}

export interface RestoredTabs {
  tabs: TabHistory[];
  activeId: string;
  parked: Record<string, ParkedVideo>;
  titles: Record<string, TabTitle>;
}

export function restoreTabSession(session: SavedTabSession): RestoredTabs {
  const restored: RestoredTabs = { tabs: [], activeId: "", parked: {}, titles: {} };
  session.tabs.forEach((saved, position) => {
    const id = createTabId();
    const entries = saved.entries.map((entry) =>
      createEntry({ pathname: entry.pathname, search: entry.search ?? "", hash: entry.hash ?? "" }),
    );
    restored.tabs.push({ id, entries, index: saved.index });
    if (saved.parked) restored.parked[id] = saved.parked;
    const current = entries[saved.index];
    if (saved.title && current) restored.titles[id] = { key: current.key, text: saved.title };
    if (position === session.active) restored.activeId = id;
  });
  return restored;
}
