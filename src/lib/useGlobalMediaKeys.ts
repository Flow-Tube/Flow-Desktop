import { useEffect, useState } from "react";

import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";
import { globalMediaKeysSupported, setGlobalMediaKeys } from "./api/mediaKeys";
import { getString } from "./i18n/index";
import { IS_MACOS_RUNTIME } from "./platform";
import { SETTINGS } from "./settings/schema";
import { useBoolPref } from "./usePreference";

/** Null until the backend answers; false on a Wayland session. */
export function useGlobalMediaKeysSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let disposed = false;
    void globalMediaKeysSupported().then((value) => {
      if (!disposed) setSupported(value);
    });
    return () => {
      disposed = true;
    };
  }, []);
  return supported;
}

/** Applies the setting to the backend. If the system refuses the keys the switch goes back off. */
export function useGlobalMediaKeys(): void {
  const [enabled, setEnabled] = useBoolPref(SETTINGS.GLOBAL_MEDIA_KEYS_ENABLED);
  const loaded = useAppSettingsStore((state) => state.loaded);

  useEffect(() => {
    if (!loaded) return;
    let stale = false;
    setGlobalMediaKeys(enabled).catch(() => {
      if (stale || !enabled) return;
      setEnabled(false);
      useUiStore.getState().showToast({
        variant: "error",
        message: getString(IS_MACOS_RUNTIME ? "settings_global_media_keys_failed_macos" : "settings_global_media_keys_failed"),
      });
    });
    return () => {
      stale = true;
    };
  }, [loaded, enabled]);
}
