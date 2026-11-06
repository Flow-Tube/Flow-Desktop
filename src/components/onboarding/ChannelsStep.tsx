import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { ChannelCard } from "../channel/ChannelCard";
import { SearchInput } from "../ui/SearchInput";
import { getPlural, getString } from "../../lib/i18n/index";
import { useChannelSearch } from "../../lib/useChannelSearch";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import { ONBOARDING_CARD_GRID } from "./constants";

export function ChannelsStep() {
  const [searchQuery, setSearchQuery] = useState("");
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const loadSubscriptions = useSubscriptionStore((state) => state.loadSubscriptions);
  const { channels, loading } = useChannelSearch(searchQuery);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const toggleSubscribed = (channel: (typeof channels)[number]) => {
    const { isSubscribed, subscribe, unsubscribe } = useSubscriptionStore.getState();
    if (isSubscribed(channel.channelId)) void unsubscribe(channel.channelId, { learn: true });
    else void subscribe(channel.channelId, channel.name, channel.avatarUrl ?? undefined, { learn: true });
  };

  return (
    <div className="flex w-full flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
            {getString("onboarding_channels_title")}
          </h1>
          <p className="text-lg text-chrome-neutral-400">{getString("onboarding_channels_subtitle")}</p>
        </div>
        {subscriptions.length > 0 && (
          <span className="shrink-0 rounded-full bg-surface-container-high px-4 py-2 text-xs font-medium text-chrome-neutral-200">
            {getPlural("onboarding_channels_configured", subscriptions.length)}
          </span>
        )}
      </div>

      <SearchInput
        pill
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder={getString("onboarding_type_creator_or_channel_name")}
        trailing={loading ? <Loader2 size={16} className="animate-spin text-primary" /> : null}
      />

      {searchQuery.trim() ? (
        channels.length === 0 && !loading ? (
          <p className="py-8 text-center text-sm text-chrome-neutral-400">
            {getString("onboarding_channels_no_results")}
          </p>
        ) : (
          <div className={ONBOARDING_CARD_GRID}>
            {channels.map((channel) => (
              <ChannelCard
                key={channel.channelId}
                fill
                channelId={channel.channelId}
                name={channel.name}
                avatarUrl={channel.avatarUrl}
                subtitle={channel.subscriberCountText ?? channel.handle}
                onOpen={() => toggleSubscribed(channel)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Search className="h-8 w-8 text-chrome-neutral-500" aria-hidden="true" />
          <h2 className="text-sm font-medium text-chrome-neutral-200">
            {getString("onboarding_search_for_creators")}
          </h2>
          <p className="max-w-xs text-xs text-chrome-neutral-400">{getString("onboarding_channels_prompt")}</p>
        </div>
      )}
    </div>
  );
}

export default ChannelsStep;
