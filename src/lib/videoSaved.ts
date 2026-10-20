import { logInteraction } from "./api/recommendation";
import { isMusicVideo } from "./utils";
import { isKnownShort } from "./videoKind";
import type { VideoSummary } from "../types/video";

/**
 * A save (Watch later, a playlist, a download) tells the recommendation engine the viewer wants
 * this video: a strong signal, weaker than a like. Music never teaches the video engine.
 */
export function noteVideoSaved(video: VideoSummary) {
  if (isMusicVideo(video)) return;
  void logInteraction(
    video.id,
    video.title,
    video.channelName,
    video.channelId ?? video.id,
    null,
    video.durationSeconds ?? null,
    Boolean(video.isLive),
    isKnownShort(video.durationSeconds),
    "SAVED",
    0,
  ).catch((err) => console.warn("Failed to log a saved video", err));
}
