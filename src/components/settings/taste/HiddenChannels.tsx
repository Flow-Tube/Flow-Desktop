import { Loader2 } from "lucide-react";
import { getString } from "../../../lib/i18n/index";
import type { NamedChannel } from "../../../lib/api/recommendation";

interface HiddenChannelsProps {
  channels: NamedChannel[];
  unblocking: string | null;
  onUnblock: (channelId: string) => void;
}

/** The channels the viewer blocked, by name where this device knows one. */
export function HiddenChannels({ channels, unblocking, onUnblock }: HiddenChannelsProps) {
  if (channels.length === 0) {
    return <p className="text-sm text-chrome-neutral-500">{getString("taste_hidden_channels_empty")}</p>;
  }
  return (
    <ul className="divide-y divide-chrome-neutral-800">
      {channels.map((channel) => (
        <li key={channel.id} className="flex items-center justify-between gap-4 py-2">
          <span className="min-w-0 truncate text-sm text-chrome-neutral-200">
            {channel.name || getString("taste_channel_unnamed")}
          </span>
          <button
            type="button"
            disabled={unblocking !== null}
            onClick={() => onUnblock(channel.id)}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-chrome-neutral-700 px-3 text-sm text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-chrome-neutral-800 disabled:cursor-wait disabled:opacity-60"
          >
            {unblocking === channel.id && <Loader2 size={14} className="animate-spin" />}
            {getString("taste_unblock_channel")}
          </button>
        </li>
      ))}
    </ul>
  );
}
