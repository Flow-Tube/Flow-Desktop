import { useLocation } from "react-router-dom";
import { useMediaQuery } from "./useMediaQuery";

/** Below Tailwind's `sm` the side rail is hidden, so the menu opens the drawer instead. */
export const NARROW_WINDOW_QUERY = "(max-width: 639px)";

/** Whether the side menu opens as a drawer over the page: on Watch and Settings, and in a narrow window. */
export function useSidebarDrawer(): boolean {
  const { pathname } = useLocation();
  const narrow = useMediaQuery(NARROW_WINDOW_QUERY);
  return narrow || pathname.startsWith("/watch/") || pathname.startsWith("/settings");
}
