import type { VideoPlayerMode } from "../store/usePlayerStore";

const WATCH_ROUTE_RE = /^\/watch\/([^/?#]+)/;

export function watchVideoIdFromPath(pathname: string): string | null {
  const match = pathname.match(WATCH_ROUTE_RE);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export type WatchRouteSyncAction =
  | { kind: "none" }
  | { kind: "play-queued"; index: number }
  | { kind: "play-offline" }
  | { kind: "play-stub" };

export interface WatchRouteSyncInput {
  routeVideoId: string | undefined;
  currentVideoId: string | null;
  /** The route's id differs from the one the watch page last synced. */
  routeChanged: boolean;
  retryRequested: boolean;
  queuedIndex: number;
  hasOfflineRecord: boolean;
}

/**
 * What the watch page does when its route and the player disagree. A related
 * click, Next or autoplay changes the player first and the route a moment later,
 * because the router renders navigation in a transition. Acting on that gap put
 * the old video back for one render, so every switch played new, old, new. The
 * route only leads when its own id changed; otherwise the player leads and
 * GlobalVideoPlayer moves the route to it.
 */
export function decideWatchRouteSync(input: WatchRouteSyncInput): WatchRouteSyncAction {
  const { routeVideoId, currentVideoId } = input;
  if (!routeVideoId || currentVideoId === routeVideoId) return { kind: "none" };
  if (currentVideoId !== null && !input.routeChanged && !input.retryRequested) return { kind: "none" };
  if (input.queuedIndex >= 0) return { kind: "play-queued", index: input.queuedIndex };
  if (input.hasOfflineRecord) return { kind: "play-offline" };
  return { kind: "play-stub" };
}

export type RouteChangePlayerAction = "none" | "expand" | "enter-pip" | "dismiss";

export interface RouteChangePlayerInput {
  previousWatchId: string | null;
  nextWatchId: string | null;
  currentVideoId: string | null;
  videoPlayerMode: VideoPlayerMode;
  autoPipEnabled: boolean;
  /** Switching tabs leaves the video running in the mini player, whatever the setting says. */
  tabSwitch: boolean;
}

/** What the player does when the route moves, from the store as it is now. */
export function decideRouteChangePlayerAction(input: RouteChangePlayerInput): RouteChangePlayerAction {
  const { currentVideoId, nextWatchId } = input;
  if (!currentVideoId) return "none";
  if (nextWatchId === currentVideoId) return input.videoPlayerMode === "pip" ? "expand" : "none";
  if (nextWatchId !== null || input.previousWatchId !== currentVideoId || input.videoPlayerMode !== "watch") {
    return "none";
  }
  return input.autoPipEnabled || input.tabSwitch ? "enter-pip" : "dismiss";
}
