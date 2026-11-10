import { routeForYoutubeUrl, type ParsedYoutubeUrl } from "./youtubeUrl";

/** Where a link opened from outside Flow takes the user, as on Flow for Android. */
export type LinkDestination =
  /** `playlistId` is the queue to play it in. */
  | { kind: "video"; videoId: string; playlistId: string | null }
  | { kind: "music"; videoId: string; playlistId: string | null }
  | { kind: "page"; route: string }
  /** A handle or custom name, which the backend has to resolve first. */
  | { kind: "channel"; url: string; music: boolean };

/** The account's own lists can't be read without the account, and only have a local page here. */
const ACCOUNT_LIST_ROUTES: Record<string, string> = {
  LL: "/liked",
  LM: "/liked",
  WL: "/watch-later",
};

/** A mix is built around one video and can't be browsed on its own. */
export function isMix(playlistId: string): boolean {
  return playlistId.startsWith("RD") && !playlistId.startsWith("RDCLAK");
}

/** The backend reads playlist ids of this length; a shorter one can't be a queue. */
const QUEUE_ID = /^[A-Za-z0-9_-]{10,64}$/;

/** Null for a link Flow has no page for. */
export function linkDestination(link: ParsedYoutubeUrl): LinkDestination | null {
  switch (link.kind) {
    case "video": {
      const list = link.playlistId && !(link.playlistId in ACCOUNT_LIST_ROUTES) ? link.playlistId : null;
      if (link.music) return { kind: "music", videoId: link.videoId, playlistId: list };
      return { kind: "video", videoId: link.videoId, playlistId: list && !isMix(list) && QUEUE_ID.test(list) ? list : null };
    }
    case "playlist":
    case "musicPlaylist": {
      const account = ACCOUNT_LIST_ROUTES[link.playlistId];
      if (account) return { kind: "page", route: account };
      if (isMix(link.playlistId)) return null;
      break;
    }
    case "resolveChannel":
      return { kind: "channel", url: link.url, music: link.music };
  }
  const route = routeForYoutubeUrl(link);
  return route ? { kind: "page", route } : null;
}
