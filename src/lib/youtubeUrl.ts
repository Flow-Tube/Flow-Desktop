import { shortsPlayerDisabledNow } from "./useShortsContent";
import { musicEnabledNow } from "./useMusicContent";

export type ParsedYoutubeUrl =
  /** `playlistId` is the list a `watch?v=…&list=…` link plays the video from. */
  | { kind: "video"; videoId: string; music: boolean; playlistId: string | null }
  | { kind: "short"; videoId: string }
  | { kind: "playlist"; playlistId: string }
  | { kind: "musicPlaylist"; playlistId: string }
  | { kind: "musicAlbum"; browseId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "musicArtist"; channelId: string }
  | { kind: "resolveChannel"; url: string; music: boolean; query: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ID_CHARS = /^[A-Za-z0-9_-]+$/;
const MAX_URL_CHARS = 2048;

const YOUTUBE_DOMAINS = ["youtube.com", "youtube-nocookie.com"];
const FRONT_END_DOMAINS = ["piped.video", "yewtu.be"];
const MUSIC_HOSTS = new Set(["music.youtube.com", "m.music.youtube.com"]);
/** Album playlists are music wherever they are linked from. */
const ALBUM_PLAYLIST_PREFIX = "OLAK5uy_";

const isOrIsUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function isYoutubeHost(host: string): { yt: boolean; music: boolean; short: boolean; frontEnd: boolean } {
  const h = host.toLowerCase();
  if (isOrIsUnder(h, "youtu.be")) return { yt: true, music: false, short: true, frontEnd: false };
  const music = MUSIC_HOSTS.has(h);
  const frontEnd = FRONT_END_DOMAINS.some((domain) => isOrIsUnder(h, domain));
  return { yt: frontEnd || YOUTUBE_DOMAINS.some((domain) => isOrIsUnder(h, domain)), music, short: false, frontEnd };
}

const safeDecode = (text: string): string | null => {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
};

export function parseYoutubeUrl(raw: string): ParsedYoutubeUrl | null {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_CHARS || /\s/.test(text)) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const { yt, music, short, frontEnd } = isYoutubeHost(url.hostname);
  if (!yt) return null;

  const params = url.searchParams;
  const path = url.pathname.replace(/\/+$/, "");
  const fullUrl = `https://${music ? "music.youtube.com" : "www.youtube.com"}${url.pathname}${url.search}`;

  if (short) {
    const id = path.slice(1).split("/")[0] ?? "";
    return VIDEO_ID.test(id) ? { kind: "video", videoId: id, music: false, playlistId: null } : null;
  }

  // /shorts/ID opens the Shorts player.
  const shortId = path.match(/^\/shorts\/([A-Za-z0-9_-]{11})/)?.[1];
  if (shortId) return { kind: "short", videoId: shortId };

  // watch?v=VIDEOID, with the list it plays from if the link names one
  const list = params.get("list");
  const listId = list && ID_CHARS.test(list) ? list : null;
  const v = params.get("v");
  if (v && VIDEO_ID.test(v)) return { kind: "video", videoId: v, music, playlistId: listId };

  // Path-based video forms: /embed/ID, /v/ID, /live/ID
  const pathVideoId = path.match(/^\/(?:embed|v|live|e)\/([A-Za-z0-9_-]{11})/)?.[1];
  if (pathVideoId) return { kind: "video", videoId: pathVideoId, music, playlistId: null };

  // playlist?list=ID  (or any URL that carries a list= but no watchable v=)
  if (listId) {
    return music || listId.startsWith(ALBUM_PLAYLIST_PREFIX)
      ? { kind: "musicPlaylist", playlistId: listId }
      : { kind: "playlist", playlistId: listId };
  }

  // /channel/UC...
  const channelId = path.match(/^\/channel\/([A-Za-z0-9_-]+)/)?.[1];
  if (channelId) {
    return music
      ? { kind: "musicArtist", channelId }
      : { kind: "channel", channelId };
  }

  // /browse/<id> — YT Music albums (MPRE…), playlists (VL…), or artist channels (UC…)
  const browseId = path.match(/^\/browse\/([A-Za-z0-9_-]+)/)?.[1];
  if (browseId) {
    if (browseId.startsWith("MPRE")) return { kind: "musicAlbum", browseId };
    if (browseId.startsWith("VL")) return { kind: "musicPlaylist", playlistId: browseId.slice(2) };
    if (browseId.startsWith("UC")) {
      return music
        ? { kind: "musicArtist", channelId: browseId }
        : { kind: "channel", channelId: browseId };
    }
  }

  // Handle / custom / user URLs (need backend resolution to a UC id):
  //   /@handle, /c/Name, /user/Name, /Name (legacy vanity, on YouTube itself only)
  if (
    /^\/@[^/]+/.test(path) ||
    /^\/(?:c|user)\/[^/]+/.test(path) ||
    (!frontEnd && /^\/[^/]+$/.test(path) && !isReservedPath(path))
  ) {
    const query = safeDecode(path.split("/").filter(Boolean).pop() ?? "");
    return query === null ? null : { kind: "resolveChannel", url: fullUrl, music, query };
  }

  return null;
}

/** The in-app route for a parsed link, or null for a handle that needs resolving first. */
/** A channel's page, or its artist page for a YouTube Music link while Show Music is on. */
export function channelRoute(channelId: string, music: boolean): string {
  return music && musicEnabledNow() ? `/music/artist/${channelId}` : `/channel/${channelId}`;
}

export function routeForYoutubeUrl(parsed: ParsedYoutubeUrl): string | null {
  // With Show Music off a music link opens its YouTube page; an album has none.
  const music = musicEnabledNow();
  switch (parsed.kind) {
    case "video":
      return `/watch/${parsed.videoId}`;
    case "short":
      // The same switch Shorts cards follow.
      return shortsPlayerDisabledNow()
        ? `/watch/${parsed.videoId}`
        : `/shorts/${parsed.videoId}`;
    case "playlist":
      return `/playlist/${parsed.playlistId}`;
    case "musicPlaylist":
      return music ? `/music/playlist/${parsed.playlistId}` : `/playlist/${parsed.playlistId}`;
    case "musicAlbum":
      return music ? `/music/album/${parsed.browseId}` : null;
    case "channel":
      return `/channel/${parsed.channelId}`;
    case "musicArtist":
      return channelRoute(parsed.channelId, true);
    case "resolveChannel":
      return null;
  }
}

// Top-level YouTube paths that are NOT channel vanity URLs.
const RESERVED = new Set([
  "watch", "playlist", "shorts", "embed", "live", "results", "feed", "gaming",
  "premium", "account", "reporthistory", "upload", "channel", "browse", "hashtag",
  "post", "clip", "movies", "music", "signin", "logout", "about", "ads", "attribution_link",
  "creators", "howyoutubeworks", "iframe_api", "jobs", "kids", "live_chat", "new", "oembed",
  "redirect", "s", "sitemap.xml", "robots.txt", "favicon.ico", "studio", "t", "trending",
]);

function isReservedPath(path: string): boolean {
  return RESERVED.has(path.slice(1).toLowerCase());
}

export function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export function youtubeWatchUrl(videoId: string, positionSeconds?: number): string {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return positionSeconds === undefined ? watchUrl : `${watchUrl}&t=${Math.max(0, Math.floor(positionSeconds))}s`;
}

export function youtubeShortsUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${videoId}`;
}

export function youtubeMusicWatchUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${videoId}`;
}

export function youtubeMusicAlbumUrl(browseId: string): string {
  return `https://music.youtube.com/browse/${browseId}`;
}

export function youtubeMusicArtistUrl(channelId: string): string {
  return `https://music.youtube.com/channel/${channelId}`;
}

export function youtubeMusicPlaylistUrl(playlistId: string): string {
  return `https://music.youtube.com/playlist?list=${playlistId.replace(/^VL/, "")}`;
}

export function youtubePlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

export function youtubePostUrl(postId: string): string {
  return `https://www.youtube.com/post/${postId}`;
}
