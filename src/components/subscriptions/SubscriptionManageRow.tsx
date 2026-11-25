import type React from "react";
import { BellOff, BellRing, GripVertical, Pin, PinOff } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { getString } from "../../lib/i18n/index";
import { sortableRowStyle } from "../../lib/sortableList";
import type { SubscribedChannel } from "../../store/useSubscriptionStore";
import type { ChannelDetails } from "../../types/video";
import { Button } from "../ui/Button";
import { ChannelAvatarImage, getAvatarUrl } from "./ChannelAvatarImage";

export interface SubscriptionManageRowProps {
  channel: SubscribedChannel;
  details?: ChannelDetails;
  pinned: boolean;
  /** Shows a drag handle; the row must sit in a SortableContext. */
  draggable: boolean;
  notificationsOn: boolean;
  onTogglePin: (channelId: string) => void;
  onSetNotification: (channelId: string, enabled: boolean) => void;
  onOpenChannel: (channelId: string) => void;
  onUnsubscribe: (channelId: string) => void;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function RowBody({
  channel,
  details,
  pinned,
  notificationsOn,
  onTogglePin,
  onSetNotification,
  onOpenChannel,
  onUnsubscribe,
  handle,
}: Omit<SubscriptionManageRowProps, "draggable"> & { handle?: React.ReactNode }) {
  const avatarUrl = getAvatarUrl(channel.avatarUrl) || getAvatarUrl(details?.avatarUrl);
  return (
    <>
      {handle}
      <button
        type="button"
        onClick={() => onOpenChannel(channel.id)}
        className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-sm font-semibold text-chrome-neutral-400 ${FOCUS}`}
      >
        {avatarUrl ? <ChannelAvatarImage src={avatarUrl} name={channel.name} /> : channel.name.charAt(0).toUpperCase()}
      </button>

      <button type="button" onClick={() => onOpenChannel(channel.id)} className={`min-w-0 flex-1 text-start ${FOCUS}`}>
        <div dir="auto" className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{channel.name}</div>
        <div className="line-clamp-1 text-xs text-chrome-neutral-400">
          {channel.subscriberCountText || details?.subscriberCountText || getString("subscriptions_subscribers_unavailable")}
        </div>
      </button>

      <Button
        variant="ghost"
        size="sm"
        title={getString(pinned ? "subscriptions_unpin" : "subscriptions_pin")}
        aria-label={getString(pinned ? "subscriptions_unpin" : "subscriptions_pin")}
        aria-pressed={pinned}
        className={pinned ? "text-[var(--color-primary)]" : "text-chrome-neutral-400"}
        onClick={() => onTogglePin(channel.id)}
      >
        {pinned ? <PinOff size={16} /> : <Pin size={16} />}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        title={getString(notificationsOn ? "subscription_notifications_on" : "subscription_notifications_off")}
        aria-pressed={notificationsOn}
        className={notificationsOn ? "text-[var(--color-primary)]" : "text-chrome-neutral-400"}
        onClick={() => onSetNotification(channel.id, !notificationsOn)}
      >
        {notificationsOn ? <BellRing size={16} /> : <BellOff size={16} />}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-chrome-red-400 hover:bg-chrome-red-950/30"
        onClick={() => onUnsubscribe(channel.id)}
      >
        {getString("subscriptions_unsubscribe")}
      </Button>
    </>
  );
}

const ROW = "flex items-center gap-4 py-3 pe-4 transition-colors duration-200 ease-out";

function SortableManageRow(props: Omit<SubscriptionManageRowProps, "draggable">) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.channel.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={sortableRowStyle(transform, transition)}
      className={`${ROW} ps-2 ${isDragging ? "relative z-10 bg-surface-container-high" : "hover:bg-surface-container"}`}
    >
      <RowBody
        {...props}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={getString("subscriptions_drag", props.channel.name)}
            className={`-me-2 grid h-8 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-chrome-neutral-500 transition-colors duration-200 ease-out hover:text-chrome-neutral-200 active:cursor-grabbing ${FOCUS}`}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

/** One followed channel in Manage: open, pin, notifications, unfollow, and a handle when the list can be reordered. */
export function SubscriptionManageRow({ draggable, ...props }: SubscriptionManageRowProps) {
  if (draggable) return <SortableManageRow {...props} />;
  return (
    <div className={`${ROW} ps-4 hover:bg-surface-container`}>
      <RowBody {...props} />
    </div>
  );
}
