import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';

export function MusicNowPlayingSettings() {
  const [background, setBackground] = usePreference(SETTINGS.MUSIC_PLAYER_BACKGROUND);
  const [artworkControlColors, setArtworkControlColors] = useBoolPref(SETTINGS.MUSIC_ARTWORK_CONTROL_COLORS);
  const [plainControlColors, setPlainControlColors] = usePreference(SETTINGS.MUSIC_PLAIN_CONTROL_COLORS);
  const [followLightTheme, setFollowLightTheme] = useBoolPref(SETTINGS.MUSIC_PLAYER_FOLLOW_LIGHT_THEME);

  return (
    <SettingsGroup title={getString('settings_group_music_now_playing')}>
      <SettingItem title={getString('settings_music_player_background')} description={getString('settings_music_player_background_desc')}>
        <Select value={background} onChange={setBackground} options={[
          { value: 'blur_gradient', label: getString('settings_music_player_background_blur_gradient') },
          { value: 'blur', label: getString('settings_music_player_background_blur') },
          { value: 'gradient', label: getString('settings_music_player_background_gradient') },
          { value: 'immersive', label: getString('settings_music_player_background_immersive') },
          { value: 'default', label: getString('settings_music_player_background_default') },
        ]} />
      </SettingItem>
      <SettingItem title={getString('settings_music_artwork_control_colors')} description={getString('settings_music_artwork_control_colors_desc')}>
        <ToggleSwitch checked={artworkControlColors} onChange={setArtworkControlColors} />
      </SettingItem>
      {!artworkControlColors && (
        <SettingItem title={getString('settings_music_plain_control_colors')} description={getString('settings_music_plain_control_colors_desc')}>
          <Select value={plainControlColors} onChange={setPlainControlColors} options={[
            { value: 'monochrome', label: getString('settings_music_plain_control_colors_monochrome') },
            { value: 'app_theme', label: getString('settings_music_plain_control_colors_app_theme') },
          ]} />
        </SettingItem>
      )}
      <SettingItem title={getString('settings_music_player_follow_light_theme')} description={getString('settings_music_player_follow_light_theme_desc')}>
        <ToggleSwitch checked={followLightTheme} onChange={setFollowLightTheme} />
      </SettingItem>
    </SettingsGroup>
  );
}
