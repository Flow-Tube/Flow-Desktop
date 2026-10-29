import { useEffect } from "react";

import { onJoinRequests } from "./api/linked";
import { IS_MAIN_WINDOW } from "./appWindow";
import { isTauriEnv } from "./api/env";
import { getString } from "./i18n/index";
import { useUiStore } from "../store/useUiStore";

/** Tells the user, on any page of the main window, when a background sync finds a device asking to join. */
export function useJoinRequestNotice(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void isTauriEnv().then(async (tauri) => {
      if (!tauri || !IS_MAIN_WINDOW) return;
      const stop = await onJoinRequests((requests) => {
        useUiStore.getState().showToast({
          message: getString("linked_join_request_notice", requests.map((r) => r.name).join(", ")),
          actions: [{ label: getString("linked_open"), to: "/sync" }],
        });
      });
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
