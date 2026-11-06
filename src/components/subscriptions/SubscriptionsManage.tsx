import { useMemo, useState } from "react";
import { BellOff, BellRing, User } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { channelsOfKind, type SubscriptionKind, type SubscriptionSortMode } from "../../lib/subscriptionSort";
import type { SubscribedChannel } from "../../store/useSubscriptionStore";
import type { ChannelDetails } from "../../types/video";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { FilterSelect } from "../ui/FilterSelect";
import { ChannelAvatarImage, getAvatarUrl } from "./ChannelAvatarImage";

interface SubscriptionsManageProps {
  channels: SubscribedChannel[];
  channelDetails: Record<string, ChannelDetails>;
  sortMode: SubscriptionSortMode;
  onSortChange: (mode: SubscriptionSortMode) => void;
  channelNotifications: Record<string, boolean>;
  onSetNotification: (channelId: string, enabled: boolean) => void;
  onOpenChannel: (channelId: string) => void;
  onUnsubscribe: (channelId: string) => void;
}

/** The followed channels as a list to manage, video channels and music artists apart. */
export function SubscriptionsManage({
  channels,
  channelDetails,
  sortMode,
  onSortChange,
  channelNotifications,
  onSetNotification,
  onOpenChannel,
  onUnsubscribe,
}: SubscriptionsManageProps) {
  const [kind, setKind] = useState<SubscriptionKind>("video");
  const shown = useMemo(() => channelsOfKind(channels, kind), [channels, kind]);

  return (
    <section className="pt-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-chrome-neutral-100">{getString("subscriptions_manage_header")}</h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">{getString("subscriptions_manage_subtitle", shown.length)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Chip active={kind === "video"} aria-pressed={kind === "video"} onClick={() => setKind("video")}>
            {getString("subscriptions_kind_videos")}
          </Chip>
          <Chip active={kind === "music"} aria-pressed={kind === "music"} onClick={() => setKind("music")}>
            {getString("subscriptions_kind_music")}
          </Chip>
          <FilterSelect<SubscriptionSortMode>
            label={getString("subscriptions_sort_label")}
            value={sortMode}
            onChange={onSortChange}
            options={[
              { value: "", label: getString("subscriptions_sort_default") },
              { value: "name", label: getString("subscriptions_sort_name") },
              { value: "recent", label: getString("subscriptions_sort_recent") },
            ]}
          />
        </div>
      </div>

      {shown.length > 0 ? (
        <div className="divide-y divide-chrome-neutral-800 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low">
          {shown.map((channel) => {
            const details = channelDetails[channel.id];
            const avatarUrl = getAvatarUrl(channel.avatarUrl) || getAvatarUrl(details?.avatarUrl);
            const notifOn = channelNotifications[channel.id] !== false;
            return (
              <div
                key={channel.id}
                className="flex items-center gap-4 px-4 py-3 transition-colors duration-200 ease-out hover:bg-surface-container"
              >
                <button
                  type="button"
                  onClick={() => onOpenChannel(channel.id)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-sm font-semibold text-chrome-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {avatarUrl ? <ChannelAvatarImage src={avatarUrl} name={channel.name} /> : channel.name.charAt(0).toUpperCase()}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenChannel(channel.id)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{channel.name}</div>
                  <div className="line-clamp-1 text-xs text-chrome-neutral-400">
                    {channel.subscriberCountText || details?.subscriberCountText || getString("subscriptions_subscribers_unavailable")}
                  </div>
                </button>

                <Button
                  variant="ghost"
                  size="sm"
                  title={getString(notifOn ? "subscription_notifications_on" : "subscription_notifications_off")}
                  aria-pressed={notifOn}
                  className={notifOn ? "text-[var(--color-primary)]" : "text-chrome-neutral-400"}
                  onClick={() => onSetNotification(channel.id, !notifOn)}
                >
                  {notifOn ? <BellRing size={16} /> : <BellOff size={16} />}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-chrome-red-400 hover:bg-chrome-red-950/30"
                  onClick={() => onUnsubscribe(channel.id)}
                >
                  {getString("subscriptions_unsubscribe")}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
          <User className="mb-3 text-chrome-neutral-600" size={36} />
          <h3 className="text-base font-medium text-chrome-neutral-200">{getString("subscriptions_empty_manage")}</h3>
          <p className="mt-1 max-w-md text-sm text-chrome-neutral-400">{getString("subscriptions_empty_manage_body")}</p>
        </div>
      )}
    </section>
  );
}
