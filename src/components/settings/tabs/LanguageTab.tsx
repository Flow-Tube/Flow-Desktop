import { appLanguageOptions } from '../../../lib/i18n/appLanguageOptions';
import { useAppLanguage } from '../../../lib/i18n/useAppLanguage';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { REGION_OPTIONS } from '../../../lib/regionOptions';
import { CONTENT_LANGUAGE_OPTIONS } from '../../../lib/contentLanguages';

export function LanguageTab() {
  const [appLanguage, setAppLanguage] = useAppLanguage();
  const [regionPicker, setRegionPicker] = useBoolPref(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE, true);
  const [trendingRegion, setTrendingRegion] = usePreference(SETTINGS.TRENDING_REGION, 'US');
  const [contentLanguage, setContentLanguage] = usePreference(SETTINGS.CONTENT_LANGUAGE, '');
  const [originalTitles, setOriginalTitles] = useBoolPref(SETTINGS.ORIGINAL_TITLES, false);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_language_region')}>
        <SettingItem title={getString('settings_app_language')} description={getString('settings_app_language_desc')}>
          <Select value={appLanguage} onChange={setAppLanguage} options={appLanguageOptions()} />
        </SettingItem>
        <SettingItem title={getString('settings_region_picker')} description={getString('settings_region_picker_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE)}><ToggleSwitch checked={regionPicker} onChange={setRegionPicker} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE)} /></SettingItem>
        <SettingItem title={getString('settings_trending_region')} description={getString('settings_trending_region_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.TRENDING_REGION)}><Select value={trendingRegion} onChange={setTrendingRegion} options={REGION_OPTIONS} disabled={isSettingDisabledUntilWired(SETTINGS.TRENDING_REGION)} /></SettingItem>
        <SettingItem title={getString('settings_content_language')} description={getString('settings_content_language_desc')}>
          <Select
            value={contentLanguage}
            onChange={setContentLanguage}
            options={[{ value: '', label: getString('settings_content_language_default') }, ...CONTENT_LANGUAGE_OPTIONS]}
          />
        </SettingItem>
        <SettingItem title={getString('settings_original_titles')} description={getString('settings_original_titles_desc')}><ToggleSwitch checked={originalTitles} onChange={setOriginalTitles} /></SettingItem>
      </SettingsGroup>
    </div>
  );
}
