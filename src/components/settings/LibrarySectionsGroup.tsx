import { getString } from "../../lib/i18n/index";
import { LIBRARY_SECTIONS, toggledHiddenSections, useHiddenLibrarySections } from "../../lib/librarySections";
import { SETTINGS } from "../../lib/settings/schema";
import { usePreference } from "../../lib/usePreference";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingItem } from "./SettingItem";
import { SettingsGroup } from "./SettingsGroup";

/** A switch for each shelf of the Library page. */
export function LibrarySectionsGroup() {
  const hidden = useHiddenLibrarySections();
  const [, setRaw] = usePreference(SETTINGS.HIDDEN_LIBRARY_SECTIONS);

  return (
    <SettingsGroup title={getString("settings_group_library_sections")}>
      {LIBRARY_SECTIONS.map((section) => (
        <SettingItem key={section.id} title={getString(section.title)}>
          <ToggleSwitch
            checked={!hidden.has(section.id)}
            onChange={(shown) => setRaw(toggledHiddenSections(hidden, section.id, !shown))}
          />
        </SettingItem>
      ))}
    </SettingsGroup>
  );
}
