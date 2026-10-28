import { parsePath, type To } from "react-router-dom";

/** One page in a tab's back/forward list. `key` also names its saved scroll position. */
export interface TabEntry {
  key: string;
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

export interface TabHistory {
  id: string;
  entries: TabEntry[];
  index: number;
}

/** Long sessions would otherwise grow every tab's list (and its saved copy) without bound. */
export const MAX_TAB_ENTRIES = 50;

export function createEntryKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createEntry(to: To, state: unknown = null): TabEntry {
  const path = typeof to === "string" ? parsePath(to) : to;
  return {
    key: createEntryKey(),
    pathname: path.pathname || "/",
    search: path.search ?? "",
    hash: path.hash ?? "",
    state,
  };
}

export function currentEntry(tab: TabHistory): TabEntry {
  const entry = tab.entries[tab.index];
  if (!entry) throw new Error(`Tab ${tab.id} has no entry at ${tab.index}`);
  return entry;
}

/** Like a browser: a new page drops everything forward of the current one. */
export function pushEntry(tab: TabHistory, entry: TabEntry): TabHistory {
  const entries = [...tab.entries.slice(0, tab.index + 1), entry];
  const overflow = Math.max(0, entries.length - MAX_TAB_ENTRIES);
  return { ...tab, entries: entries.slice(overflow), index: entries.length - 1 - overflow };
}

export function replaceEntry(tab: TabHistory, entry: TabEntry): TabHistory {
  const entries = [...tab.entries];
  entries[tab.index] = entry;
  return { ...tab, entries };
}

/** `null` when the step leaves the list, so Back on the first page does nothing. */
export function goInTab(tab: TabHistory, delta: number): TabHistory | null {
  const index = tab.index + delta;
  if (delta === 0 || index < 0 || index >= tab.entries.length) return null;
  return { ...tab, index };
}
