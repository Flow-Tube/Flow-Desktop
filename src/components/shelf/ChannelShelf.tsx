import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { ChannelCard } from "../channel/ChannelCard";
import type { ChannelSummaryItem } from "../../types/video";

interface ChannelShelfProps {
  title: string;
  channels: ChannelSummaryItem[];
  action?: React.ReactNode;
}

/** Channels another channel features on its Home tab. */
export const ChannelShelf: React.FC<ChannelShelfProps> = ({ title, channels, action }) => {
  if (channels.length === 0) return null;
  return (
    <div className="relative flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-chrome-zinc-100">{title}</h2>
        {action}
      </div>
      <ShelfScroller className="-mx-3 flex gap-4 px-3 pb-3 pt-3">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.channelId}
            channelId={channel.channelId}
            name={channel.name}
            avatarUrl={channel.avatarUrl}
            subtitle={channel.subscriberCountText}
            className="shrink-0"
          />
        ))}
      </ShelfScroller>
    </div>
  );
};
