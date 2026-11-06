import { confirmAction } from '../../lib/dialogs';
import { getString, type StringKey } from '../../lib/i18n/index';
import { SETTINGS } from '../../lib/settings/schema';
import { useBoolPref, useNumberPref } from '../../lib/usePreference';
import { useSearchHistoryStore } from '../../store/useSearchHistoryStore';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { SettingItem } from './SettingItem';
import { SettingsGroup } from './SettingsGroup';

const HISTORY_SIZES = [25, 50, 100, 200, 500];
const RETENTION_PERIODS: readonly (readonly [number, StringKey])[] = [
  [7, 'settings_retention_one_week'],
  [30, 'settings_retention_one_month'],
  [90, 'settings_retention_three_months'],
  [180, 'settings_retention_six_months'],
  [365, 'settings_retention_one_year'],
];

/** What Flow keeps of your watching and searching, and for how long. */
export function SearchHistoryGroup() {
  const [pausedHistory, setPausedHistory] = useBoolPref(SETTINGS.PAUSE_WATCH_HISTORY, false);
  const [saveSearches, setSaveSearches] = useBoolPref(SETTINGS.SEARCH_HISTORY_ENABLED, true);
  const [suggestions, setSuggestions] = useBoolPref(SETTINGS.SEARCH_SUGGESTIONS_ENABLED, true);
  const [maxSize, setMaxSize] = useNumberPref(SETTINGS.SEARCH_HISTORY_MAX_SIZE, 50);
  const [autoDelete, setAutoDelete] = useBoolPref(SETTINGS.AUTO_DELETE_SEARCH_HISTORY, false);
  const [retention, setRetention] = useNumberPref(SETTINGS.SEARCH_HISTORY_RETENTION_DAYS, 90);
  const trimTo = useSearchHistoryStore((state) => state.trimTo);
  const clear = useSearchHistoryStore((state) => state.clear);

  const handleMaxSize = (value: string) => {
    setMaxSize(Number(value));
    trimTo(Number(value));
  };

  const handleClear = async () => {
    const confirmed = await confirmAction({
      title: getString('settings_clear_search_history'),
      message: getString('settings_clear_search_history_confirm'),
      confirmLabel: getString('clear'),
      destructive: true,
    });
    if (confirmed) clear();
  };

  return (
    <SettingsGroup title={getString('settings_group_search_history')}>
      <SettingItem title={getString('settings_pause_watch_history')} description={getString('settings_pause_watch_history_desc')}>
        <ToggleSwitch checked={pausedHistory} onChange={setPausedHistory} />
      </SettingItem>
      <SettingItem title={getString('settings_save_search_history')} description={getString('settings_save_search_history_desc')}>
        <ToggleSwitch checked={saveSearches} onChange={setSaveSearches} />
      </SettingItem>
      <SettingItem title={getString('settings_search_suggestions')} description={getString('settings_search_suggestions_desc')}>
        <ToggleSwitch checked={suggestions} onChange={setSuggestions} />
      </SettingItem>
      <SettingItem title={getString('settings_search_history_size')} disabled={!saveSearches}>
        <Select
          value={String(maxSize)}
          onChange={handleMaxSize}
          disabled={!saveSearches}
          options={HISTORY_SIZES.map((size) => ({ value: String(size), label: getString('settings_search_history_size_option', size) }))}
        />
      </SettingItem>
      <SettingItem
        title={getString('settings_auto_delete_search_history')}
        description={getString(autoDelete ? 'settings_auto_delete_search_history_on' : 'settings_auto_delete_search_history_off')}
        disabled={!saveSearches}
      >
        <ToggleSwitch checked={autoDelete} onChange={setAutoDelete} disabled={!saveSearches} />
      </SettingItem>
      <SettingItem title={getString('settings_search_history_retention')} disabled={!saveSearches || !autoDelete}>
        <Select
          value={String(retention)}
          onChange={(value) => setRetention(Number(value))}
          disabled={!saveSearches || !autoDelete}
          options={RETENTION_PERIODS.map(([days, label]) => ({ value: String(days), label: getString(label) }))}
        />
      </SettingItem>
      <SettingItem title={getString('settings_clear_search_history')} description={getString('settings_clear_search_history_desc')}>
        <Button type="button" variant="secondary" size="sm" onClick={() => void handleClear()}>
          {getString('clear')}
        </Button>
      </SettingItem>
    </SettingsGroup>
  );
}
