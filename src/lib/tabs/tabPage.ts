import type { SidebarNavIconName } from "../../components/ui/SidebarNavIcon";
import { watchVideoIdFromPath } from "../watchRouteSync";

/** What a tab's row shows as its picture, from the page it is on. */
export type TabIcon =
  | { kind: "video"; videoId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "shorts" }
  | { kind: "search" }
  | { kind: "nav"; name: SidebarNavIconName };

const NAV_ICONS: Array<[prefix: string, name: SidebarNavIconName]> = [
  ["/feed", "feed"],
  ["/explore", "explore"],
  ["/music", "music"],
  ["/subscriptions", "subscriptions"],
  ["/library", "you"],
  ["/history", "history"],
  ["/playlists", "playlists"],
  ["/playlist", "playlists"],
  ["/albums", "albums"],
  ["/watch-later", "watchLater"],
  ["/saved-shorts", "watchLater"],
  ["/liked", "liked"],
  ["/downloads", "downloads"],
  ["/settings", "settings"],
  ["/sync", "sync"],
  ["/sponsorblock", "extensions"],
  ["/support", "support"],
];

export function tabIconFor(pathname: string): TabIcon {
  const videoId = watchVideoIdFromPath(pathname);
  if (videoId) return { kind: "video", videoId };
  const channel = pathname.match(/^\/channel\/([^/?#]+)/);
  if (channel?.[1]) return { kind: "channel", channelId: decodeURIComponent(channel[1]) };
  if (pathname.startsWith("/shorts")) return { kind: "shorts" };
  if (pathname === "/search") return { kind: "search" };
  const nav = NAV_ICONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return { kind: "nav", name: nav?.[1] ?? "home" };
}
