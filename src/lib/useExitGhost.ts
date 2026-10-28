import { useLayoutEffect, type RefObject } from "react";
import { playExitGhost } from "./motion";

/** Fades the element out when it unmounts, without the caller keeping it mounted. */
export function useExitGhost(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current;
    // StrictMode's rehearsal unmount runs before the first frame; only a menu that was seen fades out.
    let shown = false;
    const frame = requestAnimationFrame(() => {
      shown = true;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (shown && node?.isConnected) playExitGhost(node);
    };
  }, [ref]);
}
