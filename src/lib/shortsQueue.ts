import type { ShortItem } from "../types/shorts";
import type { ShortVideoSummary } from "../types/video";

export function shortSummaryToItem(short: ShortVideoSummary): ShortItem {
  return {
    id: short.id,
    title: short.title || "Short",
    channelName: short.channelName ?? "",
    channelId: short.channelId ?? null,
    thumbnailUrl: short.thumbnailUrl ?? `https://i.ytimg.com/vi/${short.id}/oar2.jpg`,
    channelAvatarUrl: short.channelAvatarUrl ?? null,
    viewCountText: short.viewCountText ?? null,
    likeCountText: null,
    commentCountText: null,
    publishedText: short.publishedText ?? null,
    sequenceParams: null,
  };
}

export function shortItemToSummary(short: ShortItem): ShortVideoSummary {
  return {
    type: "short",
    id: short.id,
    title: short.title,
    channelName: short.channelName,
    channelId: short.channelId,
    thumbnailUrl: short.thumbnailUrl,
    channelAvatarUrl: short.channelAvatarUrl,
    viewCountText: short.viewCountText,
    publishedText: short.publishedText,
  };
}

export function buildShortQueue(shorts: ShortVideoSummary[]): ShortItem[] {
  const seen = new Set<string>();
  return shorts.map(shortSummaryToItem).filter((short) => {
    if (!short.id || seen.has(short.id)) return false;
    seen.add(short.id);
    return true;
  });
}
