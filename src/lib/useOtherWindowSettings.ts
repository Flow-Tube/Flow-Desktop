import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { CURRENT_WINDOW_LABEL } from "./appWindow";
import { DATA_CHANGED_EVENT, type DataChangedPayload } from "./windowEvents";
import { refreshForSettingKeys } from "./storeRefresh";
import { isSettingKey } from "./settings/values";

/**
 * The pop-out starts from a copy of the settings and has no shell to keep it current, so a change
 * made in Settings during a pop-out session reaches its player through this.
 */
export function useOtherWindowSettings(): void {
  useEffect(() => {
    const subscription = listen<DataChangedPayload>(DATA_CHANGED_EVENT, ({ payload }) => {
      if (payload.source === CURRENT_WINDOW_LABEL) return;
      const settingKeys = payload.keys.filter(isSettingKey);
      if (settingKeys.length > 0) void refreshForSettingKeys(settingKeys);
    });
    return () => {
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}
