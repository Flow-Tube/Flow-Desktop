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
import { acceptAppend, acceptSnapshot, acceptStatus } from "./homeFeedUpdates";

/**
 * Home's feed as the backend builds it: opened on mount, kept current by its events, paged as the
 * last visible card nears the end. Snapshots of an older load never replace a newer one.
 */
export function useHomeFeed(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot>({ ...EMPTY_HOME_SNAPSHOT, loading: enabled });
  const [failed, setFailed] = useState(false);
  const lastViewportRef = useRef(-1);

  // Each change is worked out against the snapshot as it stands now, not as it was last
  // rendered, and an unchanged snapshot is handed back as the same object.
  const latestRef = useRef(snapshot);
  const commit = useCallback((next: HomeSnapshot) => {
    latestRef.current = next;
    setSnapshot(next);
  }, []);
  const accept = useCallback((next: HomeSnapshot) => commit(acceptSnapshot(latestRef.current, next)), [commit]);

  useEffect(() => {
    if (!enabled) {
      commit(EMPTY_HOME_SNAPSHOT);
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const stop = await onHomeFeedChanged({
          onSnapshot: (next) => {
            if (!disposed) accept(next);
          },
          onStatus: (status) => {
            if (!disposed) commit(acceptStatus(latestRef.current, status));
          },
          onAppend: (append) => {
            if (disposed) return;
            const next = acceptAppend(latestRef.current, append);
            if (next) {
              commit(next);
              return;
            }
            // A page that doesn't follow what is shown means an event was missed.
            void openHomeFeed()
              .then((opened) => {
                if (!disposed) accept(opened);
              })
              .catch(() => undefined);
          },
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
  }, [enabled, accept, commit]);

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
