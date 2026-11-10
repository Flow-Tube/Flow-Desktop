import { useEffect, type RefObject } from "react";
import { usePlayerStore } from "../store/usePlayerStore";

const WIDEST = 16 / 9;
/** Anything narrower than a phone-shot video still gets this shape, so the page keeps a usable player. */
const NARROWEST = 9 / 16;

/**
 * The shape the watch page's player takes: taller for a video narrower than 16:9, or null for the
 * normal 16:9 frame. The slot caps its height so a vertical video still fits on screen.
 */
export function adaptivePlayerAspect(videoAspect: number | null, enabled: boolean, theater: boolean): number | null {
  if (!enabled || theater || videoAspect === null || !(videoAspect > 0)) return null;
  if (videoAspect >= WIDEST - 0.01) return null;
  return Math.max(NARROWEST, videoAspect);
}

/** Tells the store the shape of the video playing, which is known only once its metadata has loaded. */
export function useReportVideoAspect(videoRef: RefObject<HTMLVideoElement | null>, videoId: string | undefined): void {
  const setVideoAspect = usePlayerStore((s) => s.setVideoAspect);
  useEffect(() => {
    setVideoAspect(null);
    const video = videoRef.current;
    if (!video) return;
    const report = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setVideoAspect(video.videoWidth / video.videoHeight);
    };
    video.addEventListener("loadedmetadata", report);
    video.addEventListener("resize", report);
    return () => {
      video.removeEventListener("loadedmetadata", report);
      video.removeEventListener("resize", report);
    };
  }, [setVideoAspect, videoId, videoRef]);
}
