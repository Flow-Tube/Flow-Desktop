import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePlayerStore } from "../store/usePlayerStore";
import { useFeedHiddenFilter } from "../store/useFeedActionsStore";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import {
  getVideoDetails,
  getChannelDetails,
  getPlaylistDetails,
  getRelatedVideos,
} from "../lib/api/youtube";
import { getSponsorBlockSegments, getReturnYouTubeDislike, getDeArrowOverride } from "../lib/api/foss";
import { useDownloadedVideoRecord, downloadRecordToVideo } from "../lib/useDownloads";
import { usePlaybackSettled } from "../lib/usePlaybackSettled";
import { setSetting } from "../lib/api/db";
import { seekToTime } from "../lib/linkify";
import { getString } from "../lib/i18n/index";
import { Chapters } from "../components/player/chapters";
import { QueuePanel } from "../components/player/QueuePanel";
import {
  WatchLayout,
  WatchMetadata,
  DescriptionCard,
  RelatedVideos,
  LiveChat,
  WatchPageSkeleton,
  WatchErrorState,
} from "../components/watch";
import { WatchPlayerSlot } from "../components/watch/WatchPlayerSlot";
import type { RelatedContentItem, VideoSummary } from "../types/video";
import { SETTINGS } from "../lib/settings/schema";

const CommentsSection = lazy(() => import("../components/watch/CommentsSection"));

function mapRelatedItemToVideoSummary(item: RelatedContentItem): VideoSummary {
  return {
    id: item.videoId || item.id,
    title: item.title,
    channelName: item.channelName,
    channelId: item.channelId,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    publishedText: item.publishedText,
    viewCountText: item.viewCountText,
    isLive: item.isLive,
  };
}

export function Watch() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const { loadSettings } = useSettingsStore();

  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const enrichCurrentVideo = usePlayerStore((s) => s.enrichCurrentVideo);
  const playQueueItem = usePlayerStore((s) => s.playQueueItem);
  const dearrowData = usePlayerStore((s) => s.dearrowData);
  const rydData = usePlayerStore((s) => s.rydData);
  const setDearrowData = usePlayerStore((s) => s.setDearrowData);
  const setRydData = usePlayerStore((s) => s.setRydData);
  const setSponsorBlockSegments = usePlayerStore((s) => s.setSponsorBlockSegments);
  const isChaptersPanelOpen = usePlayerStore((s) => s.isChaptersPanelOpen);
  const setIsChaptersPanelOpen = usePlayerStore((s) => s.setIsChaptersPanelOpen);
  const isQueuePanelOpen = usePlayerStore((s) => s.isQueuePanelOpen);
  const setAutoplayCandidates = usePlayerStore((s) => s.setAutoplayCandidates);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const captions = usePlayerStore((s) => s.captions);
  const setWatchPageCache = usePlayerStore((s) => s.setWatchPageCache);

  const { loadSubscriptions } = useSubscriptionStore();
  const commentsEnabled = useAppSettingsStore((state) => state.values[SETTINGS.COMMENTS_ENABLED] !== "false");
  const relatedVideosEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SHOW_RELATED_VIDEOS] !== "false");

  const [channelDetails, setChannelDetails] = useState<any>(null);
  const [videoDetails, setVideoDetails] = useState<any>(null);
  const [relatedVideos, setRelatedVideos] = useState<RelatedContentItem[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const offlineRecord = useDownloadedVideoRecord(videoId);
  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  useEffect(() => {
    if (!videoId) return;
    if (currentVideo && currentVideo.id === videoId) return;

    const queuedIndex = usePlayerStore.getState().queue.findIndex((item) => item.id === videoId);
    if (queuedIndex >= 0) {
      playQueueItem(queuedIndex);
      return;
    }

    if (offlineRecord) {
      setPageError(null);
      setQueue([downloadRecordToVideo(offlineRecord)], 0);
      return;
    }

    // A cold open — a deep link, a reload, a notification — knows the id and
    // nothing else. Playback needs only the id, so the player is handed a stub
    // and starts resolving immediately; the title and channel are filled in from
    // the details request below once it answers. The old order made every cold
    // open pay for metadata before the first byte.
    setPageError(null);
    setQueue([{ id: videoId, title: "", channelName: "" }], 0);
  }, [videoId, currentVideo, playQueueItem, setQueue, retryNonce, offlineRecord]);

  // Fills in the stub a cold open started with. Details are fetched once, by the
  // effect below, so this never costs a request of its own.
  useEffect(() => {
    if (!videoId || !videoDetails || videoDetails.id !== videoId) return;
    if (!currentVideo || currentVideo.id !== videoId || currentVideo.title) return;
    enrichCurrentVideo(videoId, {
      title: videoDetails.title,
      channelName: videoDetails.channelName,
      thumbnailUrl: videoDetails.thumbnailUrl,
      durationSeconds: videoDetails.durationSeconds,
      channelId: videoDetails.channelId,
    });
  }, [videoId, videoDetails, currentVideo, enrichCurrentVideo]);

  useEffect(() => {
    if (!videoId) return;
    const currentCache = usePlayerStore.getState().watchPageCache;
    const cachedWatchPage = currentCache?.videoId === videoId ? currentCache : null;

    setChannelDetails(cachedWatchPage?.channelDetails ?? null);
    setVideoDetails(cachedWatchPage?.videoDetails ?? null);
    setRelatedVideos(cachedWatchPage?.relatedVideos ?? []);
    // Related content is fetched only after playback starts, so hold its
    // skeleton up meanwhile rather than showing an empty rail.
    setRelatedLoading(
      relatedVideosEnabled && !offlineRecord && !cachedWatchPage?.relatedVideos?.length,
    );

    if (offlineRecord) {
      setAutoplayCandidates([]);
      setRelatedLoading(false);
      return;
    }

    // Details share the player response playback just resolved, so this is a
    // cache hit rather than a second client ladder — and chapters, description
    // and the live flag are all read from it. SponsorBlock stays on this pass
    // too: a segment starting at 0:00 has to be known before playback reaches it.
    const loadVideoMeta = async () => {
      try {
        const detailsRes = cachedWatchPage?.videoDetails ?? (await getVideoDetails(videoId));
        setVideoDetails(detailsRes);
        setWatchPageCache(videoId, { videoDetails: detailsRes });
      } catch (err) {
        console.warn("Failed to load extra details", err);
        // A cold open is still holding a stub with nothing but an id. Drop it so
        // the page shows its error state rather than a player bound to a video
        // nothing is known about.
        const stub = usePlayerStore.getState().currentVideo;
        if (stub?.id === videoId && !stub.title) {
          setPageError(getString("watch_error_body"));
          usePlayerStore.getState().clearQueue();
        }
      }
    };

    const loadSponsorBlock = async () => {
      try {
        await loadSettings();
        const settings = useSettingsStore.getState();
        if (!settings.sponsorBlockEnabled) {
          setSponsorBlockSegments([]);
          return;
        }
        setSponsorBlockSegments(
          await getSponsorBlockSegments(videoId, settings.serverUrl).catch(() => []),
        );
      } catch (e) {
        console.warn("Failed SponsorBlock loading process", e);
      }
    };

    void loadVideoMeta();
    void loadSponsorBlock();
  }, [
    videoId,
    retryNonce,
    setSponsorBlockSegments,
    setAutoplayCandidates,
    setWatchPageCache,
    loadSettings,
    relatedVideosEnabled,
    offlineRecord,
  ]);

  // Everything below is page furniture, not playback. Each item costs its own
  // request, and opening them all while the player is still resolving puts them
  // in direct competition with the first media buffer — so they wait until
  // playback has actually started (or the grace period in the hook expires).
  const playbackSettled = usePlaybackSettled(videoId);

  useEffect(() => {
    if (!videoId || !playbackSettled) return;
    const currentCache = usePlayerStore.getState().watchPageCache;
    const cachedWatchPage = currentCache?.videoId === videoId ? currentCache : null;

    if (offlineRecord) {
      setAutoplayCandidates([]);
      setRelatedLoading(false);
      return;
    }

    let cancelled = false;

    const loadReactionMetadata = async () => {
      try {
        await loadSettings();
        const settings = useSettingsStore.getState();
        const [dearrow, ryd] = await Promise.all([
          settings.dearrowEnabled ? getDeArrowOverride(videoId).catch(() => null) : Promise.resolve(null),
          settings.rytdEnabled ? getReturnYouTubeDislike(videoId).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setDearrowData(dearrow);
        setRydData(ryd);
      } catch (e) {
        console.warn("Failed FOSS metadata loading process", e);
      }
    };

    const loadRelated = async () => {
      if (!relatedVideosEnabled) {
        setRelatedVideos([]);
        setAutoplayCandidates([]);
        setRelatedLoading(false);
        return;
      }

      if (cachedWatchPage?.relatedVideos && cachedWatchPage.relatedVideos.length > 0) {
        setRelatedVideos(cachedWatchPage.relatedVideos);
        setRelatedLoading(false);
        return;
      }

      setRelatedLoading(true);
      try {
        const related = await getRelatedVideos(videoId);
        if (cancelled) return;
        setRelatedVideos(related);
        setWatchPageCache(videoId, { relatedVideos: related });
      } catch (err) {
        console.warn("Failed to load related content", err);
        if (cancelled) return;
        setRelatedVideos([]);
        setAutoplayCandidates([]);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    };

    void loadReactionMetadata();
    void loadRelated();

    return () => {
      cancelled = true;
    };
  }, [
    videoId,
    playbackSettled,
    retryNonce,
    setDearrowData,
    setRydData,
    setAutoplayCandidates,
    setWatchPageCache,
    loadSettings,
    relatedVideosEnabled,
    offlineRecord,
  ]);

  // Keyed on the channel id rather than run with the block above, because that
  // id only exists once the details request has answered.
  const channelIdForDetails = videoDetails?.channelId ?? currentVideo?.channelId ?? null;
  useEffect(() => {
    if (!videoId || !playbackSettled || offlineRecord || !channelIdForDetails) return;
    if (channelDetails) return;

    let cancelled = false;
    void (async () => {
      try {
        const channel = await getChannelDetails(channelIdForDetails);
        if (cancelled) return;
        setChannelDetails(channel);
        setWatchPageCache(videoId, { channelDetails: channel });
      } catch (err) {
        console.warn("Failed to load channel details", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoId, playbackSettled, offlineRecord, channelIdForDetails, channelDetails, setWatchPageCache]);

  const isHidden = useFeedHiddenFilter();
  // The watch page bypassed the feed block filter, so blocked/suppressed channels resurfaced
  // in related content and autoplay. Filter them here (reactively, so a mid-watch block applies).
  const visibleRelated = useMemo(
    () =>
      relatedVideos.filter((item) => {
        if (item.itemType && item.itemType !== "video") return true; // keep playlists / mixes
        return !isHidden({ id: item.videoId || item.id, channelId: item.channelId } as VideoSummary);
      }),
    [relatedVideos, isHidden],
  );
  useEffect(() => {
    setAutoplayCandidates(visibleRelated.map(mapRelatedItemToVideoSummary));
  }, [visibleRelated, setAutoplayCandidates]);

  const handleRelatedClick = useCallback(
    async (item: RelatedContentItem) => {
      if (item.itemType === "playlist" || item.itemType === "mix") {
        if (item.playlistId) {
          try {
            const playlist = await getPlaylistDetails(item.playlistId);
            if (playlist.videos.length > 0) {
              const fallbackVideoId = item.videoId || playlist.videos[0]?.id;
              const startIndex = fallbackVideoId
                ? playlist.videos.findIndex((video) => video.id === fallbackVideoId)
                : 0;
              const safeIndex = startIndex >= 0 ? startIndex : 0;
              const startVideo = playlist.videos[safeIndex];
              if (startVideo) {
                setQueue(playlist.videos, safeIndex);
                navigate(`/watch/${startVideo.id}`);
                return;
              }
            }
          } catch (error) {
            console.warn("Failed to resolve related playlist", error);
          }
        }
        if (item.videoId) {
          setQueue([mapRelatedItemToVideoSummary(item)], 0);
          navigate(`/watch/${item.videoId}`);
        }
        return;
      }

      const targetVideoId = item.videoId || item.id;
      setQueue([mapRelatedItemToVideoSummary(item)], 0);
      navigate(`/watch/${targetVideoId}`);
    },
    [navigate, setQueue],
  );

  const retryWithProxy = useCallback(() => {
    void setSetting("proxy_enabled", "true").catch(() => {});
    setPageError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  if (!currentVideo) {
    if (pageError) {
      return <WatchErrorState message={pageError} onRetryWithProxy={retryWithProxy} onGoBack={() => navigate(-1)} />;
    }
    return <WatchPageSkeleton />;
  }

  if (!videoId) return null;

  return (
    <WatchLayout
      player={<WatchPlayerSlot />}
      metadata={
        <WatchMetadata
          currentVideo={currentVideo}
          videoData={videoDetails}
          channelDetails={channelDetails}
          dearrowData={dearrowData}
          rydData={rydData}
        />
      }
      description={<DescriptionCard currentVideo={currentVideo} videoData={videoDetails} />}
      comments={commentsEnabled && !offlineRecord && playbackSettled ? (
        <Suspense fallback={<div className="h-32" />}>
          <CommentsSection videoId={videoId} />
        </Suspense>
      ) : null}
      sidebar={
        <>
          {videoDetails?.isLive && <LiveChat videoId={videoId} />}

          {isQueuePanelOpen && (
            <div className="h-[min(720px,calc(100vh-140px))] min-h-[450px] w-full shrink-0">
              <QueuePanel />
            </div>
          )}

          {isChaptersPanelOpen && (
            <div className="h-[min(720px,calc(100vh-140px))] min-h-[450px] w-full shrink-0">
              <Chapters
                chapters={videoDetails?.chapters || []}
                captions={captions}
                videoId={videoId}
                onClose={() => setIsChaptersPanelOpen(false)}
                videoThumbnail={dearrowData?.thumbnailUrl || currentVideo?.thumbnailUrl || videoDetails?.thumbnailUrl}
                seekTo={seekToTime}
              />
            </div>
          )}

          {relatedVideosEnabled && (
            <RelatedVideos
              items={visibleRelated}
              loading={relatedLoading}
              onSelect={handleRelatedClick}
              onAddToQueue={addToQueue}
            />
          )}
        </>
      }
    />
  );
}

export default Watch;
