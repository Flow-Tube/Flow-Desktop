import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_HOME_SNAPSHOT,
  onHomeFeedChanged,
  openHomeFeed,
  refreshHomeFeed,
  reportHomeViewport,
  retryHomeLoadMore,
  setHomeFeedVisible,
  type HomeSnapshot,
} from "./api/homeFeed";

/**
 * Home's feed as the backend builds it: opened on mount, kept current by the `home-feed` event,
 * paged as the last visible card nears the end. Snapshots of an older load never replace a newer one.
 */
export function useHomeFeed(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot>({ ...EMPTY_HOME_SNAPSHOT, loading: enabled });
  const [failed, setFailed] = useState(false);
  const lastViewportRef = useRef(-1);

  const accept = useCallback((next: HomeSnapshot) => {
    setSnapshot((current) => (next.generation >= current.generation ? next : current));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_HOME_SNAPSHOT);
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const stop = await onHomeFeedChanged((next) => {
          if (!disposed) accept(next);
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        const opened = await openHomeFeed();
        if (disposed) return;
        accept(opened);
        await setHomeFeedVisible(true);
      } catch (error) {
        console.error("Home feed failed to open", error);
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
      void setHomeFeedVisible(false).catch(() => undefined);
    };
  }, [enabled, accept]);

  const refresh = useCallback(async () => {
    setFailed(false);
    lastViewportRef.current = -1;
    try {
      accept(await refreshHomeFeed());
    } catch (error) {
      console.error("Home feed failed to refresh", error);
      setFailed(true);
    }
  }, [accept]);

  const retryMore = useCallback(() => {
    void retryHomeLoadMore().catch(() => undefined);
  }, []);

  const reportViewport = useCallback((lastVisible: number) => {
    if (lastVisible === lastViewportRef.current) return;
    lastViewportRef.current = lastVisible;
    void reportHomeViewport(lastVisible).catch(() => undefined);
  }, []);

  return { snapshot, failed, refresh, retryMore, reportViewport };
}
