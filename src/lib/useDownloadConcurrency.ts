import { useEffect } from "react";

import { setDownloadConcurrency } from "./api/downloads";
import { isTauriEnv } from "./api/env";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

/** Keeps the backend's number of simultaneous downloads in step with Settings. */
export function useDownloadConcurrency(): void {
  const loaded = useAppSettingsStore((state) => state.loaded);
  const value = useAppSettingsStore((state) => state.values[SETTINGS.DOWNLOAD_CONCURRENCY]);
  useEffect(() => {
    if (!loaded) return;
    const limit = Math.min(5, Math.max(1, Number(value ?? 3) || 3));
    void isTauriEnv().then((tauri) => {
      if (tauri) void setDownloadConcurrency(limit).catch(() => {});
    });
  }, [loaded, value]);
}
