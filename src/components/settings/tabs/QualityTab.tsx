import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Select } from '../../ui/Select';
import { usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { audioLanguageOptions } from '../../../lib/audioLanguages';

const QUALITY_OPTIONS = [
  { value: 'Auto', label: getString('quality_auto') }, { value: '2160p', label: '2160p (4K)' },
  { value: '1440p', label: '1440p' }, { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' }, { value: '480p', label: '480p' },
  { value: '360p', label: '360p' }, { value: '240p', label: '240p' }, { value: '144p', label: '144p' },
];

export function QualityTab() {
  const [qualityWifi, setQualityWifi] = usePreference(SETTINGS.DEFAULT_QUALITY_WIFI, '1080p');
  const [codec, setCodec] = usePreference(SETTINGS.DEFAULT_VIDEO_CODEC, 'H.264');
  const [shortsQuality, setShortsQuality] = usePreference(SETTINGS.SHORTS_QUALITY_WIFI, '720p');
  const [audioLang, setAudioLang] = usePreference(SETTINGS.PREFERRED_AUDIO_LANGUAGE, 'original');
  const { i18n } = useTranslation();
  const languageOptions = useMemo(() => [
    { value: 'original', label: getString('settings_option_original') },
    ...audioLanguageOptions(i18n.resolvedLanguage ?? 'en'),
  ], [i18n.resolvedLanguage]);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_video_quality')}>
        <SettingItem title={getString('settings_default_resolution')} description={getString('settings_default_resolution_desc')}>
          <Select value={qualityWifi} onChange={setQualityWifi} options={QUALITY_OPTIONS} />
        </SettingItem>
        <SettingItem title={getString('settings_preferred_codec')} description={getString('settings_preferred_codec_desc')}>
          <Select value={codec} onChange={setCodec} options={[
            { value: 'Auto', label: getString('quality_auto') }, { value: 'H.264', label: 'H.264' },
            { value: 'VP9', label: 'VP9' }, { value: 'AV1', label: 'AV1' },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_shorts_quality')}>
        <SettingItem title={getString('settings_shorts_resolution')} description={getString('settings_shorts_resolution_desc')}>
          <Select value={shortsQuality} onChange={setShortsQuality} options={QUALITY_OPTIONS} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_audio')}>
        <SettingItem title={getString('settings_audio_track_language')} description={getString('settings_audio_track_language_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.PREFERRED_AUDIO_LANGUAGE)}>
          <Select value={audioLang} onChange={setAudioLang} options={languageOptions} disabled={isSettingDisabledUntilWired(SETTINGS.PREFERRED_AUDIO_LANGUAGE)} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
