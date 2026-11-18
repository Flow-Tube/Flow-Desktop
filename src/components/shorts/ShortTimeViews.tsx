import type { ComponentProps, RefObject } from "react";
import { useMediaTime } from "../../lib/useMediaTime";
import { StatsForNerds } from "../player/StatsForNerds";
import { SubtitleOverlay } from "../player/SubtitleOverlay";
import { MediaScrubber } from "../ui/MediaScrubber";

// The parts of a Short that follow its position. Each reads the video element
// itself, so the surface around them does not re-render on every time tick.

interface FollowsVideo {
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function ShortSubtitles({ videoRef, ...props }: Omit<ComponentProps<typeof SubtitleOverlay>, "currentTime"> & FollowsVideo) {
  return <SubtitleOverlay {...props} currentTime={useMediaTime(videoRef)} />;
}

export function ShortScrubber({ videoRef, ...props }: Omit<ComponentProps<typeof MediaScrubber>, "progress"> & FollowsVideo) {
  return <MediaScrubber {...props} progress={useMediaTime(videoRef)} />;
}

export function ShortStats(props: Omit<ComponentProps<typeof StatsForNerds>, "currentTime">) {
  return <StatsForNerds {...props} currentTime={useMediaTime(props.videoRef)} />;
}
