import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { useBoolPref, useNumberPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { useEqStore } from '../../../store/useEqStore';
import { CROSSFADE_LENGTHS } from '../../../lib/audio/crossfade';
import { CROSSFADE_CURVES, crossfadeLengthLabel } from '../../../lib/audio/crossfadeLabels';

const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'] as const;
export function MusicAudioSettings() {
  const [normalization, setNormalization] = useBoolPref(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION);
  const [speed, setSpeed] = useNumberPref(SETTINGS.MUSIC_PLAYBACK_SPEED);
  const [crossfade, setCrossfade] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_ENABLED);
  const [crossfadeSeconds, setCrossfadeSeconds] = useNumberPref(SETTINGS.MUSIC_CROSSFADE_SECONDS);
  const [keepAlbums, setKeepAlbums] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_KEEP_ALBUMS);
  const [fadeOnEnd, setFadeOnEnd] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_ON_AUTO_ADVANCE);
  const [fadeOnSkip, setFadeOnSkip] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_ON_SKIP);
  const [fadeCurve, setFadeCurve] = usePreference(SETTINGS.MUSIC_CROSSFADE_CURVE);
  const openEqualizer = useEqStore((s) => s.setEditorOpen);
  const curve = CROSSFADE_CURVES.find((option) => option.value === fadeCurve) ?? CROSSFADE_CURVES[0]!;

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
        <>
          <SettingItem title={getString('settings_music_crossfade_length')}>
            <Select
              value={String(crossfadeSeconds)}
              onChange={(value) => setCrossfadeSeconds(Number(value))}
              options={CROSSFADE_LENGTHS.map((seconds) => ({ value: String(seconds), label: crossfadeLengthLabel(seconds) }))}
            />
          </SettingItem>
          <SettingItem title={getString('settings_crossfade_auto')} description={getString('settings_crossfade_auto_desc')}>
            <ToggleSwitch checked={fadeOnEnd} onChange={setFadeOnEnd} />
          </SettingItem>
          <SettingItem title={getString('settings_crossfade_skip')} description={getString('settings_crossfade_skip_desc')}>
            <ToggleSwitch checked={fadeOnSkip} onChange={setFadeOnSkip} />
          </SettingItem>
          <SettingItem title={getString('settings_crossfade_albums')} description={getString('settings_crossfade_albums_desc')}>
            <ToggleSwitch checked={keepAlbums} onChange={setKeepAlbums} />
          </SettingItem>
          <SettingItem title={getString('settings_crossfade_curve')} description={getString(curve.description)}>
            <Select
              value={curve.value}
              onChange={setFadeCurve}
              options={CROSSFADE_CURVES.map((option) => ({ value: option.value, label: getString(option.label) }))}
            />
          </SettingItem>
        </>
      )}
    </SettingsGroup>
  );
}
