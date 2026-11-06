import { useCallback, useState } from "react";
import { findEarlierDownloads, retagOlderDownloads } from "./api/downloads";
import { getPlural, getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useUiStore } from "../store/useUiStore";

/** Finding files the library lost, and tagging older ones, one pass at a time. */
export function useDownloadRecovery() {
  const [running, setRunning] = useState<"find" | "retag" | null>(null);

  const findEarlier = useCallback(async () => {
    const { showToast } = useUiStore.getState();
    const { values } = useAppSettingsStore.getState();
    setRunning("find");
    try {
      const found = await findEarlierDownloads(
        values[SETTINGS.DOWNLOAD_LOCATION] || null,
        values[SETTINGS.MUSIC_DOWNLOAD_LOCATION] || null,
      );
      await useDownloadsLibraryStore.getState().load();
      showToast({
        variant: found > 0 ? "success" : "info",
        message: found > 0 ? getPlural("downloads_recovered", found) : getString("downloads_recovered_none"),
      });
    } catch (error) {
      console.error("Failed to search for earlier downloads", error);
      showToast({ variant: "error", message: getString("downloads_recover_failed") });
    } finally {
      setRunning(null);
    }
  }, []);

  const retag = useCallback(async () => {
    const { showToast } = useUiStore.getState();
    setRunning("retag");
    try {
      const result = await retagOlderDownloads();
      showToast({ message: getString("downloads_retag_result", result.tagged, result.skipped) });
    } catch (error) {
      console.error("Failed to tag older downloads", error);
      showToast({ variant: "error", message: getString("downloads_retag_failed") });
    } finally {
      setRunning(null);
    }
  }, []);

  return { running, findEarlier, retag };
}
