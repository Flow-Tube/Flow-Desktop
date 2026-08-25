import type { SubscribedChannel } from '../../store/useSubscriptionStore';
import { QuickAccessAvatar } from './QuickAccessAvatar';
import { ShelfScroller } from '../ui/ShelfScroller';

export interface ChannelSwiperProps {
  channels: SubscribedChannel[];
  selectedChannelId?: string | null;
  channelsWithNewVideos?: Set<string>;
  onSelectChannel?: (channel: SubscribedChannel) => void;
}

export function ChannelSwiper({
  channels,
  selectedChannelId,
  channelsWithNewVideos,
  onSelectChannel,
}: ChannelSwiperProps) {
  return (
    <ShelfScroller className="flex flex-row gap-4 py-4 snap-x">
      {channels.map((channel) => (
        <QuickAccessAvatar
          key={channel.id}
          name={channel.name}
          avatarUrl={channel.avatarUrl}
          active={selectedChannelId === channel.id}
          hasNewVideos={channelsWithNewVideos?.has(channel.id)}
          onClick={() => onSelectChannel?.(channel)}
        />
      ))}
    </ShelfScroller>
  );
}
