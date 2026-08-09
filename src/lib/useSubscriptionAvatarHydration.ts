import { useEffect, useMemo } from "react";
import { useSubscriptionStore, type SubscribedChannel } from "../store/useSubscriptionStore";
import { useSubscriptionChannelDetails } from "./useSubscriptionFeed";
import { upgradeAvatarUrl } from "./thumbnails";

function normalizeAvatarUrl(url?: string | null) {
  const normalized = upgradeAvatarUrl(url);
  if (!normalized?.startsWith("http")) return undefined;
  if (/ytimg\.com\/vi\//i.test(normalized)) return undefined;
  return normalized;
}

/**
 * Fetches channel details for subscriptions that are missing an avatar and
 * persists the result into the subscription store, so surfaces like the
 * sidebar show avatars without requiring a visit to the Subscriptions page.
 */
export function useSubscriptionAvatarHydration(channels: SubscribedChannel[]) {
  const mergeSubscriptions = useSubscriptionStore((s) => s.mergeSubscriptions);
  const channelsMissingAvatar = useMemo(
    () => channels.filter((channel) => !channel.avatarUrl),
    [channels],
  );
  const detailsById = useSubscriptionChannelDetails(channelsMissingAvatar);

  useEffect(() => {
    const updates: Record<string, Partial<Omit<SubscribedChannel, "id">>> = {};
    for (const channel of channelsMissingAvatar) {
      const details = detailsById[channel.id];
      if (!details) continue;

      const patch: Partial<Omit<SubscribedChannel, "id">> = {};
      const avatarUrl = normalizeAvatarUrl(details.avatarUrl);
      if (avatarUrl && avatarUrl !== channel.avatarUrl) patch.avatarUrl = avatarUrl;
      if (details.subscriberCountText && details.subscriberCountText !== channel.subscriberCountText) {
        patch.subscriberCountText = details.subscriberCountText;
      }
      if (Object.keys(patch).length > 0) updates[channel.id] = patch;
    }
    if (Object.keys(updates).length > 0) void mergeSubscriptions(updates);
  }, [detailsById, channelsMissingAvatar, mergeSubscriptions]);
}
