import { useEffect, useState, type RefObject } from "react";

/**
 * A media element's position in seconds, for a leaf that draws it: a scrubber,
 * captions, a readout. The element's owner then keeps the time out of its own
 * state, so it does not re-render on every tick.
 */
export function useMediaTime(mediaRef: RefObject<HTMLMediaElement | null>): number {
  const [time, setTime] = useState(() => mediaRef.current?.currentTime ?? 0);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const sync = () => setTime(media.currentTime || 0);
    sync();
    media.addEventListener("timeupdate", sync);
    media.addEventListener("seeking", sync);
    media.addEventListener("loadedmetadata", sync);
    return () => {
      media.removeEventListener("timeupdate", sync);
      media.removeEventListener("seeking", sync);
      media.removeEventListener("loadedmetadata", sync);
    };
  }, [mediaRef]);

  return time;
}
