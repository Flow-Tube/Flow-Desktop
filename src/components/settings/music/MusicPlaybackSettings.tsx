import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';

export function MusicPlaybackSettings() {
  const [audioQuality, setAudioQuality] = usePreference(SETTINGS.MUSIC_AUDIO_QUALITY, 'Auto');
  const [restoreQueue, setRestoreQueue] = useBoolPref(SETTINGS.MUSIC_RESTORE_QUEUE, true);
  const [resumeLongTracks, setResumeLongTracks] = useBoolPref(SETTINGS.MUSIC_RESUME_LONG_TRACKS, false);
  const [sleepTimerButton, setSleepTimerButton] = useBoolPref(SETTINGS.MUSIC_SLEEP_TIMER_BUTTON, false);
  const qualityDisabled = isSettingDisabledUntilWired(SETTINGS.MUSIC_AUDIO_QUALITY);

  return (
    <SettingsGroup title={getString('settings_group_music_playback')}>
      <SettingItem title={getString('settings_music_audio_quality')} description={getString('settings_music_audio_quality_desc')} disabled={qualityDisabled}>
        <Select value={audioQuality} onChange={setAudioQuality} disabled={qualityDisabled} options={[
          { value: 'Auto', label: getString('quality_auto') }, { value: 'High', label: getString('settings_option_high') },
          { value: 'Medium', label: getString('settings_option_medium') }, { value: 'Low', label: getString('settings_option_low') },
        ]} />
      </SettingItem>
      <SettingItem title={getString('settings_music_restore_queue')} description={getString('settings_music_restore_queue_desc')}>
        <ToggleSwitch checked={restoreQueue} onChange={setRestoreQueue} />
      </SettingItem>
      <SettingItem title={getString('settings_music_resume_long_tracks')} description={getString('settings_music_resume_long_tracks_desc')}>
        <ToggleSwitch checked={resumeLongTracks} onChange={setResumeLongTracks} />
      </SettingItem>
      <SettingItem title={getString('settings_music_sleep_timer_button')} description={getString('settings_music_sleep_timer_button_desc')}>
        <ToggleSwitch checked={sleepTimerButton} onChange={setSleepTimerButton} />
      </SettingItem>
    </SettingsGroup>
  );
}
