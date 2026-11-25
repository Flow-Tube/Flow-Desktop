import { useMemo, useState, type ReactNode } from "react";
import { User } from "lucide-react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { getString, type StringKey } from "../../lib/i18n/index";
import { resolveDragMove, useListDragSensors } from "../../lib/sortableList";
import { pinnedFirst } from "../../lib/subscriptionPins";
import { channelsOfKind, type SubscriptionKind, type SubscriptionSortMode } from "../../lib/subscriptionSort";
import type { SubscribedChannel } from "../../store/useSubscriptionStore";
import type { ChannelDetails } from "../../types/video";
import { Chip } from "../ui/Chip";
import { FilterSelect } from "../ui/FilterSelect";
import { SubscriptionManageRow } from "./SubscriptionManageRow";

interface SubscriptionsManageProps {
  /** In the chosen sort, pins not yet moved to the top. */
  channels: SubscribedChannel[];
  channelDetails: Record<string, ChannelDetails>;
  sortMode: SubscriptionSortMode;
  onSortChange: (mode: SubscriptionSortMode) => void;
  pins: string[];
  onTogglePin: (channelId: string) => void;
  /** The shown pins in their new order. */
  onReorderPins: (shown: string[]) => void;
  /** The shown channels in their new order, while the sort is the viewer's own order. */
  onReorderManual: (shown: string[]) => void;
  channelNotifications: Record<string, boolean>;
  onSetNotification: (channelId: string, enabled: boolean) => void;
  onOpenChannel: (channelId: string) => void;
  onUnsubscribe: (channelId: string) => void;
}

const SORT_OPTIONS: Array<{ value: SubscriptionSortMode; label: StringKey }> = [
  { value: "", label: "subscriptions_sort_default" },
  { value: "name", label: "subscriptions_sort_name" },
  { value: "recent", label: "subscriptions_sort_recent" },
  { value: "watched", label: "subscriptions_sort_most_watched" },
  { value: "manual", label: "subscriptions_sort_manual" },
];

/** A run of rows that drag into a new order. */
function SortableRows({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useListDragSensors();
  const handleDragEnd = (event: DragEndEvent) => {
    const move = resolveDragMove(event, ids);
    if (move) onReorder(arrayMove(ids, move[0], move[1]));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** The followed channels as a list to manage, video channels and music artists apart, pins on top. */
export function SubscriptionsManage({
  channels,
  channelDetails,
  sortMode,
  onSortChange,
  pins,
  onTogglePin,
  onReorderPins,
  onReorderManual,
  channelNotifications,
  onSetNotification,
  onOpenChannel,
  onUnsubscribe,
}: SubscriptionsManageProps) {
  const [kind, setKind] = useState<SubscriptionKind>("video");
  const shown = useMemo(() => channelsOfKind(channels, kind), [channels, kind]);
  const { pinned, rest } = useMemo(() => {
    const ordered = pinnedFirst(shown, pins);
    return { pinned: ordered.channels.slice(0, ordered.pinnedCount), rest: ordered.channels.slice(ordered.pinnedCount) };
  }, [shown, pins]);
  const manual = sortMode === "manual";

  const row = (channel: SubscribedChannel, isPinned: boolean, draggable: boolean) => (
    <SubscriptionManageRow
      key={channel.id}
      channel={channel}
      details={channelDetails[channel.id]}
      pinned={isPinned}
      draggable={draggable}
      notificationsOn={channelNotifications[channel.id] !== false}
      onTogglePin={onTogglePin}
      onSetNotification={onSetNotification}
      onOpenChannel={onOpenChannel}
      onUnsubscribe={onUnsubscribe}
    />
  );

  const subhead = (label: string) => (
    <h3 className="mb-2 mt-4 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-chrome-neutral-400">{label}</h3>
  );

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
            options={SORT_OPTIONS.map((option) => ({ value: option.value, label: getString(option.label) }))}
          />
        </div>
      </div>

      {shown.length > 0 ? (
        <>
          {pinned.length > 0 && (
            <>
              {subhead(getString("subscriptions_pinned"))}
              <div className="divide-y divide-outline-soft rounded-2xl surface-panel">
                <SortableRows ids={pinned.map((channel) => channel.id)} onReorder={onReorderPins}>
                  {pinned.map((channel) => row(channel, true, pinned.length > 1))}
                </SortableRows>
              </div>
              {rest.length > 0 && subhead(getString("subscriptions_all_channels"))}
            </>
          )}
          {rest.length > 0 && (
            <div className="divide-y divide-outline-soft rounded-2xl surface-panel">
              {manual ? (
                <SortableRows ids={rest.map((channel) => channel.id)} onReorder={onReorderManual}>
                  {rest.map((channel) => row(channel, false, rest.length > 1))}
                </SortableRows>
              ) : (
                rest.map((channel) => row(channel, false, false))
              )}
            </div>
          )}
          {manual && rest.length > 1 && (
            <p className="mt-3 px-1 text-xs text-chrome-neutral-400">{getString("subscriptions_manual_hint")}</p>
          )}
        </>
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
