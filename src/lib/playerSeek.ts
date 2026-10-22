/** Seeks whichever player is mounted, in this window or the pop-out. */
export const seekToTime = (seconds: number) => {
  window.dispatchEvent(new CustomEvent("flow-player-seek", { detail: { time: seconds } }));
};
