import React, { useState, useEffect } from "react";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import { CuratedChannel } from "./constants";
import { searchVideos } from "../../lib/api/youtube";
import { useProxyImageSrc } from "../../lib/useImageProxy";

interface ChannelsStepProps {
  selectedTopics: string[];
}

export const ChannelsStep: React.FC<ChannelsStepProps> = ({ selectedTopics: _selectedTopics }) => {
  const toSrc = useProxyImageSrc();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CuratedChannel[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { subscriptions, subscribe, unsubscribe, isSubscribed, loadSubscriptions } = useSubscriptionStore();

  useEffect(() => {
    loadSubscriptions();
  }, []);

  const handleToggleSub = async (ch: { id: string; name: string; avatar: string }) => {
    const isSubbed = isSubscribed(ch.id);
    if (isSubbed) {
      await unsubscribe(ch.id, { learn: true });
    } else {
      const avatarUrl = ch.avatar && ch.avatar.startsWith("http") ? ch.avatar : undefined;
      await subscribe(ch.id, ch.name, avatarUrl, { learn: true });
    }
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchVideos({ query: searchQuery });
        if (res && res.items) {
          const seen = new Set<string>();
          const channels: CuratedChannel[] = [];
          
          res.items.forEach((item) => {
            if (item.id.startsWith("channel:")) {
              const realChannelId = item.id.replace("channel:", "");
              if (!seen.has(realChannelId)) {
                seen.add(realChannelId);
                channels.push({
                  id: realChannelId,
                  name: item.title,
                  avatar: item.thumbnailUrl || "",
                  subscribers: item.publishedText || "Verified Creator",
                  category: "Search Results",
                });
              }
            } else if (item.channelName && !seen.has(item.channelName)) {
              seen.add(item.channelName);
              channels.push({
                id: `channel:${item.channelName}`,
                name: item.channelName,
                avatar: "",
                subscribers: "Verified Creator",
                category: "Search Results",
              });
            }
          });
          setSearchResults(channels);
        }
      } catch (err) {
        console.error("Search channels failed", err);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);



  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  const renderAvatar = (avatar: string, name: string) => {
    if (avatar && avatar.startsWith("http")) {
      return <img src={toSrc(avatar)} alt={name} className="w-full h-full object-cover" />;
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-chrome-zinc-800 text-chrome-zinc-300 text-sm font-black uppercase">
        {getInitials(name) || "CH"}
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Hero Header */}
      <div className="mb-12 flex items-end justify-between">
        <div>
          <h1 className="text-5xl font-semibold text-chrome-neutral-100 tracking-tight mb-3">
            Build your feed
          </h1>
          <p className="text-lg text-chrome-neutral-400">
            Search for creators or select from curated creators tuned to your specific feed configuration.
          </p>
        </div>
        {subscriptions.length > 0 && (
          <span className="shrink-0 ml-4 py-2 px-4 bg-primary/10 text-primary border border-primary/20 text-xs font-black uppercase rounded-full self-start select-none">
            {subscriptions.length} creators configured
          </span>
        )}
      </div>

      {/* Search Input Bar */}
      <div className="relative flex items-center bg-chrome-input-surface border border-chrome-zinc-800 focus-within:border-primary/60 rounded-2xl overflow-hidden mb-8 px-6 py-4 shadow-sm">
        <span className="text-sm text-chrome-zinc-500 font-bold select-none mr-3">Search</span>
        <input
          type="text"
          className="w-full bg-transparent outline-none border-none text-chrome-zinc-200 placeholder:text-chrome-zinc-600 text-sm font-medium"
          placeholder="Type creator or channel name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {isSearching && (
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0 ml-2" />
        )}
      </div>

      {/* Grid List */}
      <div className="space-y-4 select-none">
        {searchQuery.trim() ? (
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-chrome-zinc-500 mb-4">Search Results</h3>
            {searchResults.length === 0 && !isSearching ? (
              <p className="text-sm text-chrome-zinc-500 py-8 font-semibold text-center bg-chrome-zinc-900/10 rounded-2xl border border-zinc-850">
                No channels matched your search query.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {searchResults.map((ch) => {
                  const isSubbed = isSubscribed(ch.id);
                  return (
                    <div key={ch.id} className="flex items-center justify-between p-4 border border-chrome-zinc-800/80 bg-chrome-zinc-900/20 hover:border-chrome-zinc-700/80 rounded-2xl transition-all hover:bg-chrome-zinc-800/20 group">
                      <div className="flex items-center gap-4 w-3/4 min-w-0">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-chrome-zinc-950 border border-chrome-zinc-800 flex items-center justify-center shrink-0">
                          {renderAvatar(ch.avatar, ch.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-bold text-chrome-zinc-200 truncate block group-hover:text-primary transition-colors">{ch.name}</span>
                          <span className="text-xs text-chrome-zinc-500 truncate block">{ch.subscribers}</span>
                        </div>
                      </div>
                      <button
                        className={`text-xs font-bold px-4 py-2 border rounded-full transition-all active:scale-95 shrink-0 cursor-pointer ${
                          isSubbed
                            ? "bg-transparent border-chrome-zinc-700 text-chrome-zinc-400 hover:bg-chrome-zinc-800"
                            : "bg-primary border-primary text-chrome-white hover:bg-primary shadow-md shadow-primary/20"
                        }`}
                        onClick={() => handleToggleSub(ch)}
                      >
                        {isSubbed ? "Subscribed" : "+ Subscribe"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4 border border-dashed border-chrome-zinc-800 rounded-3xl bg-chrome-zinc-950/20 text-center">
            <div className="w-12 h-12 rounded-full bg-chrome-zinc-900 flex items-center justify-center border border-chrome-zinc-800 mb-4 text-chrome-zinc-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h4 className="text-chrome-zinc-300 font-bold text-sm mb-1">Search for creators</h4>
            <p className="text-chrome-zinc-500 text-xs max-w-xs leading-relaxed">
              Use the search bar above to look up channels, creators, or content topics to customize your subscription feed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelsStep;
