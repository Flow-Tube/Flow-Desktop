import { useEffect } from "react";

import { onSynced } from "../api/linked";
import { isTauriEnv } from "../api/env";
import { useDashboardStore } from "../../store/useDashboardStore";

/** The group's storage and recent errors, loaded with the page and again after each sync. */
export function useGroupDashboard() {
  const { dashboard, load } = useDashboardStore();
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void load();
    void isTauriEnv().then(async (tauri) => {
      if (!tauri) return;
      const unlisten = await onSynced(() => void load());
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [load]);
  return dashboard;
}
