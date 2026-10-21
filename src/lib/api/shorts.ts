import { isTauriEnv } from "./env";
import { invokeBackend } from "./errors";
import type { ShortsFeed } from "../../types/shorts";

const MOCK_SHORTS: ShortsFeed = {
  items: Array.from({ length: 8 }, (_, i) => ({
    id: `mockShort${i}`.padEnd(11, "0").slice(0, 11),
    title: `Mock Short #${i + 1} — vertical snap-scroll demo`,
    channelName: `Creator ${i + 1}`,
    channelId: `UCmock${i}`,
    thumbnailUrl: `https://picsum.photos/seed/short${i}/720/1280`,
    channelAvatarUrl: `https://picsum.photos/seed/avatar${i}/100/100`,
    viewCountText: `${(i + 1) * 137}K views`,
    likeCountText: `${(i + 1) * 12}K`,
    commentCountText: `${(i + 1) * 3}00`,
    publishedText: `${i + 1} days ago`,
    sequenceParams: null,
  })),
  continuation: null,
};

export async function getShortsFeed(
  userSubs: string[],
  seedId?: string,
  region?: string,
): Promise<ShortsFeed> {
  if (!(await isTauriEnv())) return MOCK_SHORTS;
  return invokeBackend<ShortsFeed>("get_shorts_feed", {
    seedId: seedId ?? null,
    userSubs,
    region: region ?? null,
  });
}

export async function loadMoreShorts(
  userSubs: string[],
  continuation?: string | null,
  region?: string,
): Promise<ShortsFeed> {
  if (!(await isTauriEnv())) return { items: [], continuation: null };
  return invokeBackend<ShortsFeed>("load_more_shorts", {
    continuation: continuation ?? null,
    userSubs,
    region: region ?? null,
  });
}

export async function resetShortsFeed(): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("reset_shorts_feed");
}

export interface ShortView {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string | null;
  positionMs: number;
  durationMs: number;
  completed: boolean;
}

export async function reportShortView(view: ShortView): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("report_short_view", { view });
}

export async function recordSeenShorts(ids: string[]): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("record_seen_shorts", { ids });
}
