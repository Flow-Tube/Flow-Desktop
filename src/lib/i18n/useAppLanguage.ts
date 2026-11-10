import { useCallback } from "react";

import { SETTINGS } from "../settings/schema";
import { profileStorage } from "../storage/profileStorage";
import { usePreference } from "../usePreference";
import { setSettingValue } from "../../store/useAppSettingsStore";
import { APP_LANGUAGE_STORAGE_KEY } from "./index";

/** The chosen language. Changing it reloads the window, since strings are read as the app starts. */
export function useAppLanguage(): [string, (tag: string) => void] {
  const [language] = usePreference(SETTINGS.APP_LANGUAGE, "");
  const choose = useCallback((tag: string) => {
    void setSettingValue(SETTINGS.APP_LANGUAGE, tag).finally(() => {
      if (tag) profileStorage.setItem(APP_LANGUAGE_STORAGE_KEY, tag, "device");
      else profileStorage.removeItem(APP_LANGUAGE_STORAGE_KEY, "device");
      window.location.reload();
    });
  }, []);
  return [language, choose];
}
