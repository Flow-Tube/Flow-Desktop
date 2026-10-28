import type { TabHistory } from "./tabHistory";

export function createTabId(): string {
  return `tab-${Math.random().toString(36).slice(2, 10)}`;
}

/** New tabs open right after the one you are on, like a browser's link tabs. */
export function insertTabAfter(tabs: TabHistory[], afterId: string, tab: TabHistory): TabHistory[] {
  const at = tabs.findIndex((candidate) => candidate.id === afterId);
  if (at < 0) return [...tabs, tab];
  return [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
}

/** The tab that takes over when `id` closes: the one below it, or above when it was last. */
export function neighborTab(tabs: TabHistory[], id: string): TabHistory | null {
  const at = tabs.findIndex((tab) => tab.id === id);
  if (at < 0 || tabs.length < 2) return null;
  return tabs[at + 1] ?? tabs[at - 1] ?? null;
}
