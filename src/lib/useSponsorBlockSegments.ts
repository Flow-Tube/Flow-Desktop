import { useEffect } from "react";
import { getSponsorBlockSegments, type SponsorBlockSegment } from "./api/foss";
import { downloadSponsorSegments, useDownloadedVideoRecord } from "./useDownloads";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSettingsStore } from "../store/useSettingsStore";

/**
 * Keeps the store's segments on the video this player is playing. It lives with
 * the player because the pop-out window and a queued video in the mini player
 * have no Watch page to load them.
 */
export function useSponsorBlockSegments(videoId: string | null | undefined) {
  const offlineRecord = useDownloadedVideoRecord(videoId);
  const setSegments = usePlayerStore((s) => s.setSponsorBlockSegments);

  useEffect(() => {
    // Cleared first, so a slow or failed request can't skip this video at the
    // last video's timestamps.
    setSegments([]);
    if (!videoId) return;

    let cancelled = false;
    void (async () => {
      try {
        await useSettingsStore.getState().loadSettings();
        const settings = useSettingsStore.getState();
        if (cancelled || !settings.sponsorBlockEnabled) return;

        // A saved video skips with the segments stored when it was downloaded.
        const segments = offlineRecord
          ? downloadSponsorSegments<SponsorBlockSegment>(offlineRecord)
          : await getSponsorBlockSegments(videoId, settings.serverUrl).catch(() => []);
        if (!cancelled) setSegments(segments);
      } catch (e) {
        console.warn("Failed SponsorBlock loading process", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoId, offlineRecord, setSegments]);
}
