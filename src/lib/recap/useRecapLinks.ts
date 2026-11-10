import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import type { SongItem } from "../../types/music";
import type { VideoSummary } from "../../types/video";
import type { RankedItem } from "../api/recap";

const BROWSE_ID_PREFIX = "UC";

/** Whether a ranked row has somewhere to go: topics and name-only artists have no page. */
export function rankedItemOpens(item: RankedItem): boolean {
  if (!item.id) return false;
  if (item.kind === "ARTIST") return item.id.startsWith(BROWSE_ID_PREFIX);
  return item.kind !== "OTHER";
}

function songOf(item: RankedItem): SongItem {
  return {
    id: item.id,
    title: item.name,
    artists: [],
    album: null,
    duration: null,
    musicVideoType: null,
    thumbnail: item.imageUrl,
    explicit: false,
    videoId: item.id,
    playlistId: null,
    params: null,
  };
}

function videoOf(item: RankedItem): VideoSummary {
  return {
    id: item.id,
    title: item.name,
    channelName: item.detail,
    channelId: null,
    thumbnailUrl: item.imageUrl,
    durationSeconds: 0,
    publishedText: null,
    viewCountText: null,
  };
}

/** Opens a ranked row: a channel or artist page, or plays the video or song. */
export function useRecapLinks(onPlay: (video: VideoSummary) => void) {
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((state) => state.playQueue);
  return useCallback(
    (item: RankedItem) => {
      if (item.kind === "CHANNEL") navigate(`/channel/${item.id}`);
      else if (item.kind === "ARTIST") navigate(`/music/artist/${item.id}`);
      else if (item.kind === "VIDEO") onPlay(videoOf(item));
      else if (item.kind === "TRACK") void playQueue([songOf(item)], 0);
    },
    [navigate, onPlay, playQueue],
  );
}
