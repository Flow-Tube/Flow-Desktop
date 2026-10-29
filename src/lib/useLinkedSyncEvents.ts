import { useEffect } from "react";

import { getLinkedStatus, onJoinRequests, onSynced, onSyncing } from "./api/linked";
import { isTauriEnv } from "./api/env";
import { IS_MAIN_WINDOW } from "./appWindow";
import { getString } from "./i18n/index";
import { useSyncActivityStore } from "../store/useSyncActivityStore";
import { useUiStore } from "../store/useUiStore";

/**
 * Linked-devices sync as the main window shows it on any page: whether a run is going, and devices
 * asking to join.
 */
export function useLinkedSyncEvents(): void {
  useEffect(() => {
    const stops: Array<() => void> = [];
    let cancelled = false;
    void isTauriEnv().then(async (tauri) => {
      if (!tauri || !IS_MAIN_WINDOW) return;
      const toast = useUiStore.getState().showToast;
      const setSyncing = (syncing: boolean) => useSyncActivityStore.setState({ syncing });
      const listening = await Promise.all([
        onSyncing(() => setSyncing(true)),
        onSynced(() => setSyncing(false)),
        onJoinRequests((requests) =>
          toast({
            message: getString("linked_join_request_notice", requests.map((r) => r.name).join(", ")),
            actions: [{ label: getString("linked_open"), to: "/sync" }],
          }),
        ),
      ]);
      if (cancelled) listening.forEach((stop) => stop());
      else stops.push(...listening);
      const status = await getLinkedStatus().catch(() => null);
      if (status && !cancelled) setSyncing(status.syncing);
    });
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, []);
}
