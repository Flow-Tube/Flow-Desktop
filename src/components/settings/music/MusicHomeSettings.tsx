import { useMemo } from 'react';

import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { getString } from '../../../lib/i18n/index';
import { MUSIC_HOME_SHELVES, parseHiddenShelves, withShelfShown } from '../../../lib/musicHomeShelves';
import { SETTINGS } from '../../../lib/settings/schema';
import { usePreference } from '../../../lib/usePreference';

/** One switch per music home section; a hidden section is left out of the feed. */
export function MusicHomeSettings() {
  const [raw, setRaw] = usePreference(SETTINGS.MUSIC_HOME_HIDDEN_SHELVES);
  const hidden = useMemo(() => parseHiddenShelves(raw), [raw]);

  return (
    <SettingsGroup title={getString('settings_group_music_home')}>
      {MUSIC_HOME_SHELVES.map((shelf) => (
        <SettingItem key={shelf.id} title={getString(shelf.title)}>
          <ToggleSwitch
            checked={!hidden.has(shelf.id)}
            onChange={(shown) => setRaw(JSON.stringify(withShelfShown(hidden, shelf.id, shown)))}
          />
        </SettingItem>
      ))}
    </SettingsGroup>
  );
}
