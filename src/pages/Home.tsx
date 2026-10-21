import React, { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useFeedHiddenFilter } from "../store/useFeedActionsStore";
import { getString } from "../lib/i18n/index";
import { SETTINGS } from "../lib/settings/schema";
import { useHomeFeed } from "../lib/useHomeFeed";
import { useContinueWatching } from "../lib/useContinueWatching";
import {
  ALL_CHIP,
  NEW_TO_YOU_CHIP,
  RECENT_CHIP,
  interestChipKey,
  interestChipLabel,
  useHomeChips,
} from "../lib/useHomeChips";
import { homeOriginLabel } from "../lib/homeOrigin";
import type { VideoSummary } from "../types/video";
import { VideoGrid } from "../components/video/VideoGrid";
import { VideoShelf } from "../components/shelf/VideoShelf";
import { HomeFeedFooter } from "../components/home/HomeFeedFooter";
import { HomeFeedMessage } from "../components/home/HomeFeedMessage";
import { HomeFeedButton } from "../components/home/HomeFeedButton";
import { HomeChipRow } from "../components/home/HomeChipRow";

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
  const hideWatchedVideos = useAppSettingsStore((state) => state.values[SETTINGS.HIDE_WATCHED_VIDEOS] === "true");
  const isHidden = useFeedHiddenFilter({ hideWatched: hideWatchedVideos });
  const { snapshot, failed, refresh, retryMore, reportViewport } = useHomeFeed(homeFeedEnabled);
  const continueWatching = useContinueWatching(continueWatchingEnabled);
  const chips = useHomeChips(homeFeedEnabled);
  const chipOptions = useMemo(
    () => [
      { key: ALL_CHIP, label: getString("home_chip_all") },
      ...chips.interests.map((chip) => ({ key: interestChipKey(chip), label: interestChipLabel(chip) })),
      { key: NEW_TO_YOU_CHIP, label: getString("home_chip_new_to_you") },
      { key: RECENT_CHIP, label: getString("home_chip_recently_uploaded") },
    ],
    [chips.interests],
  );
  const chipVideos = useMemo(
    () => (chips.feed?.status === "ready" ? chips.feed.cards.filter((card) => !isHidden(card)) : []),
    [chips.feed, isHidden],
  );
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

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

  const shelfVideos = useMemo(
    () => continueWatching.videos.filter((video) => !isHidden(video)),
    [continueWatching.videos, isHidden],
  );
  const continueShelf = useMemo(
    () =>
      shelfVideos.length > 0 ? (
        <VideoShelf
          title={getString("continue_watching_shelf_title")}
          videos={shelfVideos}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
          onRemoveFromContinueWatching={continueWatching.hide}
          variant="continue"
        />
      ) : null,
    [shelfVideos, onPlay, onAddToQueue, continueWatching.hide],
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
          insertNode={continueShelf}
          trackImpressions
          getReason={reasonOf}
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
