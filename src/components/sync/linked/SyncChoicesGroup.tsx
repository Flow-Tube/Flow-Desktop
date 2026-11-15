import { getString } from "../../../lib/i18n/index";
import { SYNC_CHOICES, useSyncChoices } from "../../../lib/linked/syncChoices";
import { useUiStore } from "../../../store/useUiStore";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingItem } from "../../settings/SettingItem";
import { SettingsGroup } from "../../settings/SettingsGroup";

/** What this device syncs. A choice left out is neither sent nor received here; the other devices keep it. */
export function SyncChoicesGroup() {
  const { leftOut, choose } = useSyncChoices(() =>
    useUiStore.getState().showToast({
      variant: "error",
      title: getString("settings_save_failed_title"),
      message: getString("settings_save_failed_message"),
    }),
  );
  if (!leftOut) return null;
  return (
    <SettingsGroup title={getString("linked_sync_choices")}>
      {SYNC_CHOICES.map(([choice, name]) => {
        const syncs = !leftOut.includes(choice);
        return (
          <SettingItem
            key={choice}
            title={getString(name)}
            description={syncs ? undefined : getString("linked_choice_left_out")}
          >
            <ToggleSwitch checked={syncs} onChange={(on) => choose(choice, on)} />
          </SettingItem>
        );
      })}
    </SettingsGroup>
  );
}
