import { linkDestination } from "./linkDestination";
import { parseYoutubeUrl } from "./youtubeUrl";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const WEB_LINK = /^https?:\/\//i;

export type Handoff =
  | { action: "watch"; v: string; t?: number; list?: string }
  | { action: "music"; v: string; list?: string }
  | { action: "download"; v: string }
  | { action: "music-download"; v: string }
  | { action: "page"; route: string }
  | { action: "channel"; url: string; music: boolean };

/** Where a `flow://open?url=` link leads, or null for any link Flow has no page for. */
function openHandoff(link: string): Handoff | null {
  if (!WEB_LINK.test(link)) return null;
  const parsed = parseYoutubeUrl(link);
  const destination = parsed && linkDestination(parsed);
  if (!destination) return null;
  switch (destination.kind) {
    case "video":
      return { action: "watch", v: destination.videoId, list: destination.playlistId ?? undefined };
    case "music":
      return { action: "music", v: destination.videoId, list: destination.playlistId ?? undefined };
    case "page":
      return { action: "page", route: destination.route };
    case "channel":
      return { action: "channel", url: destination.url, music: destination.music };
  }
}

// Every transport delivers the same `flow://action?…` string: the deep-link plugin (app launched
// or already running), the loopback bridge (silent handoff from the extension, re-emitted on the
// `handoff://url` event) and a link on the command line. All of it is untrusted input.
export function parseFlowUrl(raw: string): Handoff | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "flow:") return null;

  // flow://watch → host "watch"; tolerate flow:///watch → path "/watch".
  const action = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (action === "open") return openHandoff(url.searchParams.get("url") ?? "");

  const v = url.searchParams.get("v") ?? "";
  if (!VIDEO_ID.test(v)) return null;

  if (action === "download") return { action: "download", v };
  if (action === "music-download") return { action: "music-download", v };
  if (action === "music") return { action: "music", v };
  if (action === "watch") {
    const rawT = url.searchParams.get("t");
    const t = rawT && /^\d{1,9}$/.test(rawT) ? Number(rawT) : undefined;
    const list = url.searchParams.get("list");
    const queue = list && PLAYLIST_ID.test(list) ? linkDestination({ kind: "video", videoId: v, music: false, playlistId: list }) : null;
    return { action: "watch", v, t, list: queue?.kind === "video" ? (queue.playlistId ?? undefined) : undefined };
  }
  return null;
}
