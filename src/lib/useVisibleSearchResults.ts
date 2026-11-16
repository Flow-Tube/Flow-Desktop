import { useMemo } from 'react';
import { pairCreator, withWatchState, withoutAiMusic, withoutHidden, withoutShorts } from './searchResults';
import { VIDEO_FILTER_CATEGORIES } from './searchFilterState';
import { useShortsEnabled } from './useShortsContent';
import { useWatchedVideoIds } from './useWatchedFilter';
import { useAiHidesChannel, useAiListMatcher } from './aiList/useAiList';
import { useFeedActionsStore } from '../store/useFeedActionsStore';
import { useMusicHiddenFilter } from '../store/useMusicActionsStore';
import type { UseCombinedSearchReturn } from './useCombinedSearch';

/**
 * The results this profile may see: without dismissed videos, blocked channels, AI music, hidden
 * songs, and Shorts when they're off, narrowed by the watched filter, with the matched creator paired up.
 */
export function useVisibleSearchResults(search: UseCombinedSearchReturn) {
  const dismissedVideoIds = useFeedActionsStore((s) => s.dismissedVideoIds);
  const blockedChannelIds = useFeedActionsStore((s) => s.blockedChannelIds);
  const shortsEnabled = useShortsEnabled();
  const watchFilterApplies = VIDEO_FILTER_CATEGORIES.has(search.filterType);
  const watchState = watchFilterApplies ? search.filters.watchState : 'any';
  const watchedIds = useWatchedVideoIds(watchState !== 'any');
  const hidesAsAi = useAiHidesChannel();
  const ai = useAiListMatcher();
  const isHiddenSong = useMusicHiddenFilter();

  return useMemo(() => {
    const visible = withoutAiMusic(
      withoutHidden(search.results, { videoIds: dismissedVideoIds, channelIds: blockedChannelIds, hidesAsAi }),
      ai,
    );
    const allowed = shortsEnabled ? visible : withoutShorts(visible);
    const { creator, results } = pairCreator(withWatchState(allowed, watchState, watchedIds));
    return { creator, results: { ...results, songs: results.songs.filter((song) => !isHiddenSong(song)) } };
  }, [search.results, dismissedVideoIds, blockedChannelIds, hidesAsAi, ai, shortsEnabled, watchState, watchedIds, isHiddenSong]);
}

export type VisibleSearchResults = ReturnType<typeof useVisibleSearchResults>;
