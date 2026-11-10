export const HOME_RESELECTED_EVENT = "flow:home-reselected";

/** Home's rail button was clicked while Home is already open. */
export function announceHomeReselected(): void {
  window.dispatchEvent(new Event(HOME_RESELECTED_EVENT));
}

export type HomeReselectAction = "scroll" | "refresh" | "none";

/** Down the feed a reselect only scrolls back up; at the top it refreshes, if the viewer wants that. */
export function homeReselectAction(scrollTop: number, refreshOnReselect: boolean): HomeReselectAction {
  if (scrollTop > 0) return "scroll";
  return refreshOnReselect ? "refresh" : "none";
}
