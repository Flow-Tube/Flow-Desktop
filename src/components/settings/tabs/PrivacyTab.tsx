import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import {
  DEEP_FLOW_DURATION_OPTIONS,
  DEEP_FLOW_NEVER_EXPIRES_HOURS,
  getDeepFlowDurationLabel,
  setDeepFlowEnabled,
} from '../../../lib/deepFlow';
import { useAppSettingsStore } from '../../../store/useAppSettingsStore';
import { SearchHistoryGroup } from '../SearchHistoryGroup';

export function PrivacyTab() {
  const deepFlowActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_FLOW_ACTIVE] === 'true');
  const [deepFlowExpireHours, setDeepFlowExpireHours] = usePreference(SETTINGS.DEEP_FLOW_EXPIRE_HOURS, '4');
  const [deepFlowSaveHistory, setDeepFlowSaveHistory] = useBoolPref(SETTINGS.DEEP_FLOW_SAVE_HISTORY, false);

  const deepFlowHours = Number(deepFlowExpireHours);
  const deepFlowDurationLabel = getDeepFlowDurationLabel(deepFlowHours);
  const deepFlowDescription = deepFlowActive
    ? deepFlowHours === DEEP_FLOW_NEVER_EXPIRES_HOURS
      ? getString('deep_flow_active_until_disabled')
      : getString('deep_flow_learning_paused')
    : getString('deep_flow_mode_subtitle');

  return (
    <div className="space-y-6 pb-8">
      <SearchHistoryGroup />

      <SettingsGroup title={getString('deep_flow_mode_title')}>
        <SettingItem title={getString('deep_flow_mode_title')} description={deepFlowDescription} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_ACTIVE)}>
          <ToggleSwitch
            checked={deepFlowActive}
            onChange={(enabled) => {
              void setDeepFlowEnabled(enabled);
            }}
            disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_ACTIVE)}
          />
        </SettingItem>
        <SettingItem
          title={getString('deep_flow_expire_duration_title')}
          description={getString('deep_flow_expire_duration_subtitle', deepFlowDurationLabel)}
          disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_EXPIRE_HOURS)}
        >
          <Select
            value={deepFlowExpireHours}
            onChange={setDeepFlowExpireHours}
            disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_EXPIRE_HOURS)}
            options={DEEP_FLOW_DURATION_OPTIONS.map((hours) => ({
              value: String(hours),
              label: getDeepFlowDurationLabel(hours),
            }))}
          />
        </SettingItem>
        <SettingItem title={getString('deep_flow_save_history_title')} description={getString('deep_flow_save_history_subtitle')} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_SAVE_HISTORY)}>
          <ToggleSwitch checked={deepFlowSaveHistory} onChange={setDeepFlowSaveHistory} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_SAVE_HISTORY)} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
