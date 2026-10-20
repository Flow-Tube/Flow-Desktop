import { useEffect, useState } from "react";
import { isKnownShort } from "./videoKind";
import { isMusicVideo } from "./utils";
import { logInteraction } from "./api/recommendation";
import { getString } from "./i18n/index";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import { useLikesStore } from "../store/useLikesStore";
import { useUiStore } from "../store/useUiStore";
import type { VideoSummary } from "../types/video";

export type ReactionState = "none" | "liked" | "disliked";

interface ReactionVideoMeta {
  description?: string | null;
  channelId?: string | null;
}

/**
 * Local like/dislike toggle for the active video. Reactions feed the neural
 * recommendation engine (LIKED / DISLIKED); un-toggling does not log. A
 * dislike also hides the video from every feed.
 */
export function useVideoReactions(video: VideoSummary | null, videoMeta: ReactionVideoMeta | null) {
  const [state, setState] = useState<ReactionState>("none");
  const items = useLikesStore((s) => s.items);
  const loaded = useLikesStore((s) => s.loaded);
  const loadLikes = useLikesStore((s) => s.load);
  const toggleVideoLike = useLikesStore((s) => s.toggleVideo);
  const showToast = useUiStore((s) => s.showToast);
  const hideVideo = useFeedActionsStore((s) => s.hideVideo);

  const likedInLibrary = Boolean(
    video && items.some((item) => item.kind === "video" && item.id === video.id),
  );

  useEffect(() => {
    if (!loaded) void loadLikes();
  }, [loadLikes, loaded]);

  useEffect(() => {
    setState(likedInLibrary ? "liked" : "none");
  }, [likedInLibrary, video?.id]);

  const channelId = videoMeta?.channelId || video?.channelId || video?.id || "";
  const isShort = isKnownShort(video?.durationSeconds);

  const like = () => {
    if (!video) return;
    const next: ReactionState = likedInLibrary ? "none" : "liked";
    setState(next);
    void toggleVideoLike({
      ...video,
      channelId,
    }).then((nowLiked) => {
      showToast({
        variant: "success",
        message: getString(nowLiked ? "liked_added_toast" : "liked_removed_toast"),
      });
    }).catch((err) => {
      console.warn("Failed to update likes", err);
      showToast({ variant: "error", message: getString("liked_update_failed") });
    });
    // Music played in the video player never teaches the video engine.
    if (next !== "liked" || isMusicVideo(video)) return;
    void logInteraction(
      video.id,
      video.title,
      video.channelName,
      channelId,
      videoMeta?.description ?? null,
      video.durationSeconds ?? null,
      false,
      isShort,
      "LIKED",
      1,
    ).catch((err) => console.warn("Failed to log like", err));
  };

  const dislike = () => {
    if (!video) return;
    const previous = state;
    const next: ReactionState = state === "disliked" ? "none" : "disliked";
    setState(next);
    if (next !== "disliked") return;
    if (likedInLibrary) {
      void toggleVideoLike({ ...video, channelId }).catch((err) => (
        console.warn("Failed to remove disliked video from likes", err)
      ));
    }
    if (isMusicVideo(video)) return;
    void logInteraction(
      video.id,
      video.title,
      video.channelName,
      channelId,
      videoMeta?.description ?? null,
      video.durationSeconds ?? null,
      false,
      isShort,
      "DISLIKED",
      0,
    ).then(() => hideVideo(video.id)).catch((err) => {
      console.warn("Failed to log dislike", err);
      setState(previous);
      showToast({ variant: "error", message: getString("feed_action_failed") });
    });
  };

  return { state, like, dislike };
}
