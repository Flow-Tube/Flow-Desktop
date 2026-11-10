import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, UserSearch } from "lucide-react";
import { ChannelAvatarImage } from "../components/subscriptions/ChannelAvatarImage";
import { SearchInput } from "../components/ui/SearchInput";
import { SubscribeButton } from "../components/ui/SubscribeButton";
import { getString } from "../lib/i18n/index";
import { neighbourLine, useDiscoverChannels } from "../lib/useDiscoverChannels";

interface ChannelRowProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  line?: string | null;
}

function ChannelRow({ id, name, avatarUrl, line }: ChannelRowProps) {
  return (
    <li className="flex items-center gap-4 px-4 py-3 transition-colors duration-200 ease-out hover:bg-surface-container">
      <Link
        to={`/channel/${id}`}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface-container-high">
          <ChannelAvatarImage src={avatarUrl} name={name} />
        </span>
        <span className="min-w-0">
          <span dir="auto" className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{name}</span>
          {line && <span className="line-clamp-1 text-xs text-chrome-neutral-400">{line}</span>}
        </span>
      </Link>
      <SubscribeButton channelId={id} channelName={name} avatarUrl={avatarUrl ?? undefined} size="sm" />
    </li>
  );
}

function ChannelGroup({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-primary">{title}</h2>
      <ul className="divide-y divide-chrome-neutral-800 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low">
        {children}
      </ul>
      {footer && <p className="text-xs text-chrome-neutral-500">{footer}</p>}
    </section>
  );
}

/** Find channels to follow: those like the viewer's own, those they watch unfollowed, or by search. */
export function DiscoverChannels() {
  const [query, setQuery] = useState("");
  const { neighbours, suggested, avatars, loading, search } = useDiscoverChannels(query);
  const searching = query.trim().length > 0;
  const nothingToSuggest = !loading && neighbours.length === 0 && suggested.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6 pb-20 md:px-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("discover_channels_title")}</h1>
        <p className="mt-1 text-sm text-chrome-neutral-400">{getString("discover_channels_summary")}</p>
      </header>

      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={getString("discover_channels_search")}
      />

      {searching && search.loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      )}
      {searching && !search.loading && search.failed && (
        <p className="text-sm text-chrome-neutral-400">{getString("discover_channels_search_failed")}</p>
      )}
      {searching && !search.loading && !search.failed &&
        (search.channels.length > 0 ? (
          <ChannelGroup title={getString("discover_channels_results")}>
            {search.channels.map((channel) => (
              <ChannelRow
                key={channel.channelId}
                id={channel.channelId}
                name={channel.name}
                avatarUrl={channel.avatarUrl}
                line={channel.subscriberCountText ?? channel.handle}
              />
            ))}
          </ChannelGroup>
        ) : (
          <p className="text-sm text-chrome-neutral-400">{getString("discover_channels_no_results", query.trim())}</p>
        ))}

      {!searching && (
        <>
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-primary" size={24} />
            </div>
          )}
          {neighbours.length > 0 && (
            <ChannelGroup
              title={getString("discover_channels_like_yours")}
              footer={getString("discover_channels_like_yours_footer")}
            >
              {neighbours.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  id={channel.id}
                  name={channel.name}
                  avatarUrl={channel.avatarUrl ?? avatars[channel.id]}
                  line={neighbourLine(channel.pointerNames)}
                />
              ))}
            </ChannelGroup>
          )}
          {suggested.length > 0 && (
            <ChannelGroup
              title={getString("discover_channels_suggested")}
              footer={getString("discover_channels_suggested_footer")}
            >
              {suggested.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  id={channel.id}
                  name={channel.name || getString("taste_channel_unnamed")}
                  avatarUrl={avatars[channel.id]}
                />
              ))}
            </ChannelGroup>
          )}
          {nothingToSuggest && (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
              <UserSearch className="mb-3 text-chrome-neutral-600" size={36} />
              <h3 className="text-base font-medium text-chrome-neutral-200">{getString("discover_channels_empty_title")}</h3>
              <p className="mt-1 max-w-md text-sm text-chrome-neutral-400">{getString("discover_channels_empty_body")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DiscoverChannels;
