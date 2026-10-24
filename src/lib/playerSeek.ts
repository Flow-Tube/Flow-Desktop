/** Seeks whichever player is mounted, in this window or the pop-out. */
export const seekToTime = (seconds: number) => {
  window.dispatchEvent(new CustomEvent("flow-player-seek", { detail: { time: seconds } }));
};

/**
 * Seeks the video player once a freshly opened video knows its duration: the
 * element only accepts a seek after that, so this polls briefly after navigation.
 */
export function seekWhenVideoReady(seconds: number): void {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      seekToTime(seconds);
      return;
    }
    if (attempts < 20) window.setTimeout(tick, 300);
  };
  window.setTimeout(tick, 400);
}
