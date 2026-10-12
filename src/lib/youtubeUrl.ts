export type ParsedYoutubeUrl =
  | { kind: "video"; videoId: string }
  | { kind: "playlist"; playlistId: string }
  | { kind: "musicPlaylist"; playlistId: string }
  | { kind: "musicAlbum"; browseId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "musicArtist"; channelId: string }
  | { kind: "resolveChannel"; url: string; music: boolean; query: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ID_CHARS = /^[A-Za-z0-9_-]+$/;

function isYoutubeHost(host: string): { yt: boolean; music: boolean; short: boolean } {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h === "youtu.be") return { yt: true, music: false, short: true };
  const music = h === "music.youtube.com";
  const yt = music || h === "youtube.com" || h === "m.youtube.com" || h === "gaming.youtube.com";
  return { yt, music, short: false };
}

export function parseYoutubeUrl(raw: string): ParsedYoutubeUrl | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const { yt, music, short } = isYoutubeHost(url.hostname);
  if (!yt) return null;

  const params = url.searchParams;
  const path = url.pathname.replace(/\/+$/, "");
  const fullUrl = `https://${music ? "music.youtube.com" : "www.youtube.com"}${url.pathname}${url.search}`;

  if (short) {
    const id = path.slice(1).split("/")[0] ?? "";
    return VIDEO_ID.test(id) ? { kind: "video", videoId: id } : null;
  }

  // watch?v=VIDEOID (a bare video/song wins over any &list=; a video-in-playlist plays the video)
  const v = params.get("v");
  if (v && VIDEO_ID.test(v)) return { kind: "video", videoId: v };

  // Path-based video forms: /shorts/ID, /embed/ID, /v/ID, /live/ID
  const pathVideoId = path.match(/^\/(?:shorts|embed|v|live|e)\/([A-Za-z0-9_-]{11})/)?.[1];
  if (pathVideoId) return { kind: "video", videoId: pathVideoId };

  // playlist?list=ID  (or any URL that carries a list= but no watchable v=)
  const list = params.get("list");
  if (list && ID_CHARS.test(list)) {
    return music
      ? { kind: "musicPlaylist", playlistId: list }
      : { kind: "playlist", playlistId: list };
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
  //   /@handle, /c/Name, /user/Name, /Name (legacy vanity)
  if (
    /^\/@[^/]+/.test(path) ||
    /^\/(?:c|user)\/[^/]+/.test(path) ||
    (/^\/[^/]+$/.test(path) && !isReservedPath(path))
  ) {
    const query = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    return { kind: "resolveChannel", url: fullUrl, music, query };
  }

  return null;
}

// Top-level YouTube paths that are NOT channel vanity URLs.
const RESERVED = new Set([
  "watch", "playlist", "shorts", "embed", "live", "results", "feed", "gaming",
  "premium", "account", "reporthistory", "upload", "channel", "browse", "hashtag",
  "post", "clip", "movies", "music", "signin", "logout",
]);

function isReservedPath(path: string): boolean {
  return RESERVED.has(path.slice(1).toLowerCase());
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

export function youtubePlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

export function youtubePostUrl(postId: string): string {
  return `https://www.youtube.com/post/${postId}`;
}
