import { getString } from "../../lib/i18n/index";
import { IS_LINUX_RUNTIME, IS_MACOS_RUNTIME } from "../../lib/platform";
import { SETTINGS } from "../../lib/settings/schema";
import { useGlobalMediaKeysSupported } from "../../lib/useGlobalMediaKeys";
import { useBoolPref } from "../../lib/usePreference";
import { KeyMapList } from "../shortcuts/KeyMapList";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingItem } from "./SettingItem";
import { SettingsGroup } from "./SettingsGroup";

function globalKeysDescription(unavailable: boolean): string {
  if (unavailable) return getString("settings_global_media_keys_wayland");
  if (IS_LINUX_RUNTIME) return getString("settings_global_media_keys_desc_linux");
  return getString(IS_MACOS_RUNTIME ? "settings_global_media_keys_desc_macos" : "settings_global_media_keys_desc");
}

export function KeyboardSettings() {
  const [globalKeys, setGlobalKeys] = useBoolPref(SETTINGS.GLOBAL_MEDIA_KEYS_ENABLED);
  const unavailable = useGlobalMediaKeysSupported() === false;

  return (
    <SettingsGroup title={getString("settings_group_keyboard")}>
      <SettingItem
        title={getString("settings_global_media_keys")}
        description={globalKeysDescription(unavailable)}
        disabled={unavailable}
      >
        <ToggleSwitch checked={globalKeys && !unavailable} onChange={setGlobalKeys} disabled={unavailable} />
      </SettingItem>
      <div className="px-5 py-4">
        <p className="mb-4 text-xs text-chrome-neutral-400">{getString("keyboard_shortcuts_hint")}</p>
        <KeyMapList />
      </div>
    </SettingsGroup>
  );
}
