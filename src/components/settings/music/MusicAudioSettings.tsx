import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { useBoolPref, useNumberPref } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { useEqStore } from '../../../store/useEqStore';

const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'] as const;
const CROSSFADE_SECONDS = ['1', '2', '3', '4', '5', '6', '8', '10', '12'] as const;

export function MusicAudioSettings() {
  const [normalization, setNormalization] = useBoolPref(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION);
  const [speed, setSpeed] = useNumberPref(SETTINGS.MUSIC_PLAYBACK_SPEED);
  const [crossfade, setCrossfade] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_ENABLED);
  const [crossfadeSeconds, setCrossfadeSeconds] = useNumberPref(SETTINGS.MUSIC_CROSSFADE_SECONDS);
  const openEqualizer = useEqStore((s) => s.setEditorOpen);

  return (
    <SettingsGroup title={getString('settings_group_audio')}>
      <SettingItem title={getString('music_equalizer')} description={getString('settings_music_equalizer_desc')}>
        <Button variant="secondary" onClick={() => openEqualizer(true)}>
          {getString('settings_music_equalizer_open')}
        </Button>
      </SettingItem>
      <SettingItem title={getString('music_loudness_normalization')} description={getString('music_loudness_normalization_desc')}>
        <ToggleSwitch checked={normalization} onChange={setNormalization} />
      </SettingItem>
      <SettingItem title={getString('music_playback_speed')} description={getString('settings_music_speed_desc')}>
        <Select
          value={String(speed)}
          onChange={(value) => setSpeed(Number(value))}
          options={SPEEDS.map((value) => ({ value, label: getString('music_speed_value', value) }))}
        />
      </SettingItem>
      <SettingItem title={getString('music_crossfade')} description={getString('music_crossfade_desc')}>
        <ToggleSwitch checked={crossfade} onChange={setCrossfade} />
      </SettingItem>
      {crossfade && (
        <SettingItem title={getString('settings_music_crossfade_length')}>
          <Select
            value={String(crossfadeSeconds)}
            onChange={(value) => setCrossfadeSeconds(Number(value))}
            options={CROSSFADE_SECONDS.map((value) => ({ value, label: getString('music_crossfade_seconds', value) }))}
          />
        </SettingItem>
      )}
    </SettingsGroup>
  );
}
