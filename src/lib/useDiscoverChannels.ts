import { useEffect, useState } from "react";
import { getNeighbourChannels, getTasteOverview, type NamedChannel, type NeighbourChannel } from "./api/recommendation";
import { getChannelDetails } from "./api/youtube";
import { mapWithConcurrency } from "./concurrency";
import { getString } from "./i18n/index";
import { useChannelSearch } from "./useChannelSearch";

const AVATAR_LOOKUPS = 4;

/** "A channel like X and Y", from the names that point at a neighbour. */
export function neighbourLine(pointerNames: string[]): string | undefined {
  const [first, second] = pointerNames;
  if (!first) return undefined;
  return getString("home_origin_neighbour", second ? getString("home_origin_neighbour_pair", first, second) : first);
}

/** What Discover channels lists: channels like the viewer's, those they watch unfollowed, and a search. */
export function useDiscoverChannels(query: string) {
  const [neighbours, setNeighbours] = useState<NeighbourChannel[]>([]);
  const [suggested, setSuggested] = useState<NamedChannel[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const search = useChannelSearch(query);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [neighbourResult, overviewResult] = await Promise.allSettled([getNeighbourChannels(), getTasteOverview()]);
      if (!active) return;
      const nextNeighbours = neighbourResult.status === "fulfilled" ? neighbourResult.value : [];
      const nextSuggested = overviewResult.status === "fulfilled" ? overviewResult.value.rememberedChannels : [];
      setNeighbours(nextNeighbours);
      setSuggested(nextSuggested);
      setLoading(false);
      const missing = [
        ...nextNeighbours.filter((channel) => !channel.avatarUrl).map((channel) => channel.id),
        ...nextSuggested.map((channel) => channel.id),
      ];
      // Avatars fill in as they arrive; a channel that cannot be read keeps its initial.
      await mapWithConcurrency(missing, AVATAR_LOOKUPS, async (channelId) => {
        const details = await getChannelDetails(channelId).catch(() => null);
        if (active && details?.avatarUrl) {
          const avatarUrl = details.avatarUrl;
          setAvatars((current) => ({ ...current, [channelId]: avatarUrl }));
        }
      });
    })();
    return () => {
      active = false;
    };
  }, []);

  return { neighbours, suggested, avatars, loading, search };
}
