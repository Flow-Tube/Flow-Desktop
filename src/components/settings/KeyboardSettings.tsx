import { getString } from "../../lib/i18n/index";
import { IS_LINUX_RUNTIME, IS_MACOS_RUNTIME } from "../../lib/platform";
import { SETTINGS } from "../../lib/settings/schema";
import { useGlobalMediaKeysSupported } from "../../lib/useGlobalMediaKeys";
import { useBoolPref } from "../../lib/usePreference";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingItem } from "./SettingItem";
import { SettingsGroup } from "./SettingsGroup";
import { ShortcutSettingsList } from "./shortcuts/ShortcutSettingsList";

function globalKeysDescription(unavailable: boolean): string {
  if (unavailable) return getString("settings_global_media_keys_wayland");
  if (IS_LINUX_RUNTIME) return getString("settings_global_media_keys_desc_linux");
  return getString(IS_MACOS_RUNTIME ? "settings_global_media_keys_desc_macos" : "settings_global_media_keys_desc");
}

export function KeyboardSettings() {
  const [globalKeys, setGlobalKeys] = useBoolPref(SETTINGS.GLOBAL_MEDIA_KEYS_ENABLED);
  const [singleKeys, setSingleKeys] = useBoolPref(SETTINGS.SINGLE_KEY_SHORTCUTS_ENABLED, true);
  const unavailable = useGlobalMediaKeysSupported() === false;

  return (
    <div className="space-y-6">
      <SettingsGroup title={getString("settings_group_keyboard")}>
        <SettingItem
          title={getString("settings_global_media_keys")}
          description={globalKeysDescription(unavailable)}
          disabled={unavailable}
        >
          <ToggleSwitch checked={globalKeys && !unavailable} onChange={setGlobalKeys} disabled={unavailable} />
        </SettingItem>
        <SettingItem title={getString("settings_single_key_shortcuts")} description={getString("settings_single_key_shortcuts_desc")}>
          <ToggleSwitch checked={singleKeys} onChange={setSingleKeys} />
        </SettingItem>
      </SettingsGroup>
      <ShortcutSettingsList />
    </div>
  );
}
