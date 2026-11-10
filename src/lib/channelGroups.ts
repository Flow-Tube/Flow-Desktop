import type { SubscriptionGroup } from "../store/useSubscriptionStore";

/** A group's channels with this one added or taken out. */
export function groupChannelsWith(group: SubscriptionGroup, channelId: string, member: boolean): string[] {
  const others = group.channelIds.filter((id) => id !== channelId);
  return member ? [...others, channelId] : others;
}
