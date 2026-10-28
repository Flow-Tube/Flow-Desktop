import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriEnv } from "../api/env";
import { answerPrepareSwitch, PREPARE_SWITCH_EVENT, type PrepareSwitchPayload } from "./switchProfile";

/** Mounted in every window, so a switch started anywhere waits for this window to save. */
export function useProfileSwitchListener(onSwitching?: (payload: PrepareSwitchPayload) => void): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      if (!(await isTauriEnv())) return;
      const stop = await listen<PrepareSwitchPayload>(PREPARE_SWITCH_EVENT, ({ payload }) => {
        onSwitching?.(payload);
        void answerPrepareSwitch(payload);
      });
      if (cancelled) stop();
      else unlisten = stop;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onSwitching]);
}
