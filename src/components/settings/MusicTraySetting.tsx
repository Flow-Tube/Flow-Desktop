import { SettingItem } from "./SettingItem";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";
import { useMusicTraySupported } from "../../lib/useMusicTray";

export function MusicTraySetting() {
  const [enabled, setEnabled] = useBoolPref(SETTINGS.MUSIC_TRAY_ENABLED);
  const supported = useMusicTraySupported();
  const unavailable = supported === false;

  return (
    <SettingItem
      title={getString("settings_music_tray")}
      description={unavailable ? getString("settings_music_tray_unavailable") : getString("settings_music_tray_desc")}
      disabled={unavailable}
    >
      <ToggleSwitch checked={enabled && !unavailable} onChange={setEnabled} disabled={unavailable} />
    </SettingItem>
  );
}
