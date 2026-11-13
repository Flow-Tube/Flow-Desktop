/**
 * Values of `default_nav_tab_index`, Flow for Android's tab ids (`FlowTab.id`), so the setting means
 * the same in both apps. Android's Search and Downloads tabs have no start page here.
 */
export const START_PAGES = [
  { value: "0", path: "/", label: "home" },
  { value: "3", path: "/subscriptions", label: "sidebar_subscriptions" },
  { value: "1", path: "/shorts", label: "sidebar_shorts" },
  { value: "2", path: "/music", label: "sidebar_music" },
  { value: "4", path: "/library", label: "sidebar_you" },
  { value: "6", path: "/explore", label: "sidebar_explore" },
] as const;

export interface StartPageVisibility {
  shorts: boolean;
  music: boolean;
  explore: boolean;
}

function isVisible(path: string, visible: StartPageVisibility): boolean {
  if (path === "/shorts") return visible.shorts;
  if (path === "/music") return visible.music;
  if (path === "/explore") return visible.explore;
  return true;
}

/** The pages the setting can offer, leaving out ones whose tab is turned off. */
export function startPageChoices(visible: StartPageVisibility) {
  return START_PAGES.filter((page) => isVisible(page.path, visible));
}

/** Where Flow opens, falling back to Home for an unknown value or a page that is turned off. */
export function startPagePath(value: string | null | undefined, visible: StartPageVisibility): string {
  const page = START_PAGES.find((candidate) => candidate.value === value);
  return page && isVisible(page.path, visible) ? page.path : "/";
}

const APPLIED_KEY = "flow:start-page-applied";

/**
 * True once per launch. Session storage survives a reload of the window but not a new launch, so
 * pressing F5 on Home stays on Home.
 */
export function claimStartPage(storage: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    if (storage.getItem(APPLIED_KEY)) return false;
    storage.setItem(APPLIED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
