import { useEffect } from "react";

import { getLinkedStatus, onJoinRequests, onReceived, onSynced, onSyncing, type Received } from "./api/linked";
import { isTauriEnv } from "./api/env";
import { IS_MAIN_WINDOW } from "./appWindow";
import { getString } from "./i18n/index";
import { useSyncActivityStore } from "../store/useSyncActivityStore";
import { useUiStore } from "../store/useUiStore";

/** "Received N changes from <device>". */
export function receivedMessage({ name, count }: Received): string {
  const from = name.trim() || getString("linked_another_device");
  return count === 1 ? getString("linked_received_one", from) : getString("linked_received_many", count, from);
}

/**
 * Linked-devices sync as the main window shows it on any page: whether a run is going, what a run
 * brought in, and devices asking to join.
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
        onReceived((received) => received.forEach((from) => toast({ message: receivedMessage(from) }))),
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
