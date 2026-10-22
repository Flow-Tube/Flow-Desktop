import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { resolveChannelId } from "./api/youtube";
import { openExternal } from "./openExternal";
import { seekToTime } from "./playerSeek";
import { prefetchStreamInfo } from "./streamResolution";
import { parseYoutubeUrl, routeForYoutubeUrl } from "./youtubeUrl";
import type { RichTarget } from "../types/video";

/**
 * What clicking a link in a description or comment does: timestamps seek, YouTube videos,
 * playlists and channels open in the app, hashtags search, and every other link opens in the
 * browser.
 */
export function useRichTargetHandler(): (target: RichTarget) => void {
  const navigate = useNavigate();

  const openUrl = useCallback(
    async (url: string) => {
      const parsed = parseYoutubeUrl(url);
      if (!parsed) {
        await openExternal(url);
        return;
      }
      const route = routeForYoutubeUrl(parsed);
      if (route) {
        if (parsed.kind === "video") prefetchStreamInfo(parsed.videoId);
        navigate(route);
        return;
      }
      if (parsed.kind === "resolveChannel") {
        try {
          const channelId = await resolveChannelId(parsed.url);
          navigate(parsed.music ? `/music/artist/${channelId}` : `/channel/${channelId}`);
        } catch {
          await openExternal(url);
        }
      }
    },
    [navigate],
  );

  return useCallback(
    (target: RichTarget) => {
      switch (target.kind) {
        case "timestamp":
          seekToTime(target.seconds);
          return;
        case "video":
          prefetchStreamInfo(target.videoId);
          navigate(`/watch/${target.videoId}`);
          return;
        case "playlist":
          navigate(`/playlist/${target.playlistId}`);
          return;
        case "channel":
          navigate(`/channel/${target.channelId}`);
          return;
        case "hashtag":
          navigate(`/search?q=${encodeURIComponent(target.tag)}`);
          return;
        case "url":
          void openUrl(target.url);
      }
    },
    [navigate, openUrl],
  );
}
