import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useFeedHiddenFilter } from "../store/useFeedActionsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { getString } from "../lib/i18n/index";
import { SETTINGS } from "../lib/settings/schema";
import { useHomeFeed } from "../lib/useHomeFeed";
import { useContinueWatching } from "../lib/useContinueWatching";
import { useFeedVisibilityFilter } from "../lib/useWatchedFilter";
import { useGridStyle } from "../lib/useGridColumns";
import {
  ALL_CHIP,
  LIVE_CHIP,
  MIXES_CHIP,
  NEW_TO_YOU_CHIP,
  RECENT_CHIP,
  WATCHED_CHIP,
  interestChipKey,
  interestChipLabel,
  useHomeChips,
  visibleHomeMixes,
  visibleChipKeys,
} from "../lib/useHomeChips";
import { homeOriginLabel, homeReasonLine } from "../lib/homeOrigin";
import { HOME_RESELECTED_EVENT, homeReselectAction } from "../lib/homeReselect";
import { useScrollContainer } from "../lib/useScrollContainer";
import type { HomeMix } from "../lib/api/homeFeed";
import type { VideoSummary } from "../types/video";
import { VideoGrid } from "../components/video/VideoGrid";
import { VideoShelf } from "../components/shelf/VideoShelf";
import { ShortsShelf } from "../components/shelf/ShortsShelf";
import { useHomeShortsShelf } from "../lib/useHomeShortsShelf";
import { useShortsEnabled } from "../lib/useShortsContent";
import { HomeFeedFooter } from "../components/home/HomeFeedFooter";
import { HomeFeedMessage } from "../components/home/HomeFeedMessage";
import { HomeFeedButton } from "../components/home/HomeFeedButton";
import { HomeChipRow } from "../components/home/HomeChipRow";
import { HomeMixCard } from "../components/home/HomeMixCard";

interface HomeProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

/** Home: the backend builds the feed (services/home_feed); this page lays it out. */
export const Home: React.FC<HomeProps> = ({ onPlay, onAddToQueue }) => {
  const homeFeedEnabled = useAppSettingsStore((state) => state.values[SETTINGS.HOME_FEED_ENABLED] !== "false");
  const continueWatchingEnabled = useAppSettingsStore(
    (state) => state.values[SETTINGS.CONTINUE_WATCHING_ENABLED] !== "false",
  );
  const isHidden = useFeedVisibilityFilter("home");
  const isHiddenFromRewatch = useFeedHiddenFilter({ hideWatched: false });
  const refreshOnReselect = useAppSettingsStore(
    (state) => state.values[SETTINGS.REFRESH_HOME_ON_RESELECT] !== "false",
  );
  const navigate = useNavigate();
  const setQueue = usePlayerStore((state) => state.setQueue);
  const scrollContainer = useScrollContainer();
  const { snapshot, failed, refresh, retryMore, reportViewport } = useHomeFeed(homeFeedEnabled);
  const continueWatching = useContinueWatching(continueWatchingEnabled);
  const chips = useHomeChips(homeFeedEnabled);
  const chipOptions = useMemo(() => {
    const labels = new Map([
      [ALL_CHIP, getString("home_chip_all")],
      ...chips.chips.interests.map((chip): [string, string] => [interestChipKey(chip), interestChipLabel(chip)]),
      [NEW_TO_YOU_CHIP, getString("home_chip_new_to_you")],
      [RECENT_CHIP, getString("home_chip_recently_uploaded")],
      [MIXES_CHIP, getString("home_chip_mixes")],
      [LIVE_CHIP, getString("home_chip_live")],
      [WATCHED_CHIP, getString("home_chip_watched")],
    ]);
    return visibleChipKeys(chips.chips, chips.selected).map((key) => ({ key, label: labels.get(key) ?? key }));
  }, [chips.chips, chips.selected]);
  // The Watched chip exists to show what was watched, whatever "Hide watched videos" says.
  const chipHidden = chips.selected === WATCHED_CHIP ? isHiddenFromRewatch : isHidden;
  const chipVideos = useMemo(
    () => (chips.feed?.status === "ready" ? chips.feed.cards.filter((card) => !chipHidden(card)) : []),
    [chips.feed, chipHidden],
  );
  const chipMixes = useMemo(
    () => (chips.feed?.status === "ready" ? visibleHomeMixes(chips.feed.mixes, isHiddenFromRewatch) : []),
    [chips.feed, isHiddenFromRewatch],
  );
  const playMix = useCallback(
    (mix: HomeMix) => {
      setQueue(mix.videos, 0);
      navigate(`/watch/${mix.seed.id}`);
    },
    [setQueue, navigate],
  );
  const [refreshing, setRefreshing] = useState(false);
  const gridStyle = useGridStyle();

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  const { feed: chipFeed, reload: reloadChip } = chips;
  useEffect(() => {
    const handleReselected = () => {
      const scroller = scrollContainer?.current;
      const action = homeReselectAction(scroller?.scrollTop ?? 0, refreshOnReselect);
      if (action === "scroll") scroller?.scrollTo({ top: 0 });
      else if (action === "refresh") {
        if (chipFeed) reloadChip();
        else handleRefresh();
      }
    };
    window.addEventListener(HOME_RESELECTED_EVENT, handleReselected);
    return () => window.removeEventListener(HOME_RESELECTED_EVENT, handleReselected);
  }, [scrollContainer, refreshOnReselect, chipFeed, reloadChip, handleRefresh]);

  // Cards the viewer hid leave at once; the backend drops them from its next pages too.
  const visibleVideos = useMemo(() => snapshot.cards.filter((card) => !isHidden(card)), [snapshot.cards, isHidden]);
  const feedIndex = useMemo(
    () => new Map(snapshot.cards.map((card, index) => [card.id, index])),
    [snapshot.cards],
  );
  const handleLastVisible = useCallback(
    (index: number) => {
      const id = visibleVideos[index]?.id;
      const position = id === undefined ? undefined : feedIndex.get(id);
      if (position !== undefined) reportViewport(position);
    },
    [visibleVideos, feedIndex, reportViewport],
  );
  const reasonOf = useCallback(
    (video: VideoSummary) => {
      const origin = snapshot.origins[video.id];
      return origin ? homeOriginLabel(origin) : undefined;
    },
    [snapshot.origins],
  );
  const reasonLineOf = useCallback(
    (video: VideoSummary) => homeReasonLine(snapshot.origins[video.id]),
    [snapshot.origins],
  );

  const homeShortsEnabled = useAppSettingsStore(
    (state) => state.values[SETTINGS.HOME_SHORTS_SHELF_ENABLED] !== "false",
  );
  const shortsShelvesEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_SHELF_ENABLED] !== "false");
  const shortsEnabled = useShortsEnabled();
  const homeShorts = useHomeShortsShelf(homeFeedEnabled && homeShortsEnabled && shortsShelvesEnabled && shortsEnabled);
  const shelfVideos = useMemo(
    () => continueWatching.videos.filter((video) => !isHidden(video)),
    [continueWatching.videos, isHidden],
  );
  const homeShelves = useMemo(
    () =>
      shelfVideos.length === 0 && homeShorts.length === 0 ? null : (
      <>
        {shelfVideos.length > 0 && (
          <VideoShelf
            title={getString("continue_watching_shelf_title")}
            videos={shelfVideos}
            onPlay={onPlay}
            onAddToQueue={onAddToQueue}
            onRemoveFromContinueWatching={continueWatching.hide}
            variant="continue"
          />
        )}
        <ShortsShelf title={getString("search_section_shorts")} shorts={homeShorts} onPlay={onPlay} />
      </>
    ),
    [shelfVideos, homeShorts, onPlay, onAddToQueue, continueWatching.hide],
  );

  const refreshButton = (
    <HomeFeedButton onClick={handleRefresh} disabled={refreshing || snapshot.loading}>
      <RefreshCw size={16} className={refreshing || snapshot.loading ? "animate-spin" : undefined} />
      {getString("refresh")}
    </HomeFeedButton>
  );

  let body: React.ReactNode;
  if (homeFeedEnabled && chips.feed) {
    const retryButton = (
      <HomeFeedButton onClick={chips.reload}>
        <RefreshCw size={16} />
        {getString("retry")}
      </HomeFeedButton>
    );
    if (chips.feed.status === "loading") {
      body = <VideoGrid loading onPlay={onPlay} />;
    } else if (chips.feed.status === "failed") {
      body = (
        <HomeFeedMessage
          title={getString("home_chip_error_title")}
          body={getString("home_chip_error_body")}
          action={retryButton}
        />
      );
    } else if (chipMixes.length > 0) {
      body = (
        <div className="flow-grid gap-y-8 pb-8" style={gridStyle}>
          {chipMixes.map((mix) => (
            <HomeMixCard key={mix.seed.id} mix={mix} onPlay={playMix} />
          ))}
        </div>
      );
    } else if (chipVideos.length === 0) {
      body = (
        <HomeFeedMessage
          title={getString("home_chip_empty_title")}
          body={getString("home_chip_empty_body")}
          action={retryButton}
        />
      );
    } else {
      body = <VideoGrid videos={chipVideos} onPlay={onPlay} onAddToQueue={onAddToQueue} trackImpressions />;
    }
  } else if (!homeFeedEnabled) {
    body = <HomeFeedMessage title={getString("home_feed_disabled_title")} body={getString("home_feed_disabled_body")} />;
  } else if (visibleVideos.length === 0 && snapshot.loading) {
    body = <VideoGrid loading onPlay={onPlay} />;
  } else if (visibleVideos.length === 0 && (failed || snapshot.error)) {
    body = (
      <HomeFeedMessage
        title={getString("home_feed_error_title")}
        body={getString("home_feed_error_body")}
        action={refreshButton}
      />
    );
  } else if (visibleVideos.length === 0) {
    body = (
      <HomeFeedMessage
        title={getString("home_feed_empty_title")}
        body={getString("home_feed_empty_body")}
        action={refreshButton}
      />
    );
  } else {
    body = (
      <>
        <VideoGrid
          videos={visibleVideos}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
          insertNode={homeShelves}
          trackImpressions
          getReason={reasonOf}
          getReasonLine={reasonLineOf}
          onLastVisibleIndex={handleLastVisible}
        />
        <HomeFeedFooter
          hasMore={snapshot.hasMore}
          loadingMore={snapshot.loadingMore}
          loadMoreFailed={snapshot.loadMoreFailed}
          refreshing={refreshing || snapshot.loading}
          onRefresh={handleRefresh}
          onRetry={retryMore}
        />
      </>
    );
  }

  // `<main>` above owns the scroll; an auto-height block here would only add a painted layer.
  return (
    <div className="flex-1 space-y-6 px-8 py-6">
      {homeFeedEnabled && <HomeChipRow chips={chipOptions} selected={chips.selected} onSelect={chips.select} />}
      {body}
    </div>
  );
};

export default Home;
