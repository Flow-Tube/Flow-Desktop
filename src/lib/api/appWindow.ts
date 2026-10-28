import { emitTo } from "@tauri-apps/api/event";
import type { PlaylistContext } from "../../store/usePlayerStore";
import type { StreamInfo, VideoSummary } from "../../types/video";
import { OPEN_ROUTE_EVENT } from "../windowEvents";
import { invokeBackend } from "./errors";
import { focusMainWindow } from "./pip";

/** A video moved into a new window, so it starts where it was instead of from the top. */
export interface WindowVideoHandoff {
  queue: VideoSummary[];
  currentIndex: number;
  playlistContext: PlaylistContext | null;
  positionSeconds: number;
  playing: boolean;
  stream: { info: StreamInfo; resolvedAt: number } | null;
}

export interface AppWindowSession {
  route: string;
  handoff: WindowVideoHandoff | null;
}

/** Opens another Flow window on `route`; resolves to its label. */
export function openAppWindow(route: string, handoff: WindowVideoHandoff | null = null): Promise<string> {
  return invokeBackend<string>("open_app_window", { session: { route, handoff } satisfies AppWindowSession });
}

/** What this window was opened with; null for the main window or once read. */
export function takeAppWindowSession(): Promise<AppWindowSession | null> {
  return invokeBackend<AppWindowSession | null>("app_window_session");
}

/** Shows `route` in the main window instead of this one, for pages only the main window has. */
export async function openRouteInMainWindow(route: string): Promise<void> {
  await focusMainWindow().catch(() => {});
  await emitTo("main", OPEN_ROUTE_EVENT, route);
}
