import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Download, Trash2, FileText } from 'lucide-react';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { usePreference } from '../../../lib/usePreference';
import { getSetting, setSetting, clearWatchHistory, getWatchHistory } from '../../../lib/api/db';
import { writeBackupFile } from '../../../lib/api/files';
import { buildSettingsBackupJson, type SettingsBackupScope } from '../../../lib/settings/backup';
import { confirmAction, pickSaveFile } from '../../../lib/dialogs';
import { isTauriEnv } from '../../../lib/api/env';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { useUiStore } from '../../../store/useUiStore';

export function DataTab() {
  const navigate = useNavigate();
  const showToast = useUiStore((state) => state.showToast);
  const [backupFrequency, setBackupFrequency] = usePreference(SETTINGS.AUTO_BACKUP_FREQUENCY, 'NONE');
  const [backupType, setBackupType] = usePreference(SETTINGS.AUTO_BACKUP_TYPE, 'APP_DATA');
  const [historyCount, setHistoryCount] = useState(0);
  const [subCount, setSubCount] = useState(0);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const load = async () => {
      const history = await getWatchHistory(100, 0);
      setHistoryCount(history.length);
      const subsJson = await getSetting('subscriptions');
      if (subsJson) { try { setSubCount(JSON.parse(subsJson).length); } catch {} }
    };
    load();
  }, []);

  const handleClearData = async () => {
    if (!(await confirmAction(getString('settings_clear_confirm'), getString('settings_clear_cache')))) return;
    setClearing(true);
    try {
      await clearWatchHistory();
      await setSetting('subscriptions', '[]');
      await setSetting('user_playlists', '[]');
      setHistoryCount(0);
      setSubCount(0);
      showToast({ message: getString('settings_clear_success'), variant: 'success' });
    } catch (e) {
      console.error('Failed to reset data', e);
      showToast({ message: getString('settings_clear_failed'), variant: 'error' });
    } finally {
      setClearing(false);
    }
  };

  const scopeDescriptions: Record<string, string> = {
    APP_DATA: getString('settings_backup_scope_app_data_desc'),
    BRAIN: getString('settings_backup_scope_brain_desc'),
    MASTER: getString('settings_backup_scope_master_desc'),
  };

  const handleExport = async () => {
    try {
      const jsonStr = await buildSettingsBackupJson(backupType as SettingsBackupScope);
      const defaultName = `flow_backup_${backupType.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.json`;

      if (await isTauriEnv()) {
        const savePath = await pickSaveFile(getString('settings_export_data'), defaultName, [{ name: 'JSON', extensions: ['json'] }]);
        if (!savePath) return;
        await writeBackupFile(savePath, jsonStr);
        showToast({ message: getString('settings_export_success'), variant: 'success' });
        return;
      }

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      showToast({ message: getString('settings_export_success'), variant: 'success' });
    } catch (e) {
      console.error('Export failed', e);
      showToast({ message: getString('settings_export_failed'), variant: 'error' });
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_auto_backup')}>
        <SettingItem title={getString('settings_backup_frequency')} description={getString('settings_backup_frequency_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.AUTO_BACKUP_FREQUENCY)}>
          <Select value={backupFrequency} onChange={setBackupFrequency} disabled={isSettingDisabledUntilWired(SETTINGS.AUTO_BACKUP_FREQUENCY)} options={[
            { value: 'NONE', label: getString('settings_option_disabled') }, { value: 'DAILY', label: getString('settings_backup_daily') },
            { value: 'WEEKLY', label: getString('settings_backup_weekly') }, { value: 'MONTHLY', label: getString('settings_backup_monthly') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_backup_scope')} description={scopeDescriptions[backupType] ?? getString('settings_backup_scope_desc')}>
          <Select value={backupType} onChange={setBackupType} options={[
            { value: 'APP_DATA', label: getString('settings_backup_scope_app_data') }, { value: 'BRAIN', label: getString('settings_backup_scope_brain') }, { value: 'MASTER', label: getString('settings_backup_scope_master') },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_database')}>
        <SettingItem title={getString('settings_history_records')}><span className="text-sm font-mono text-chrome-neutral-100">{historyCount}</span></SettingItem>
        <SettingItem title={getString('settings_subscriptions_count')}><span className="text-sm font-mono text-chrome-neutral-100">{subCount}</span></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_actions')}>
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 hover:bg-surface-container transition-colors duration-200 ease-out">
            <div className="flex-1 min-w-0 mr-4">
              <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_import_restore')}</div>
              <div className="text-xs text-chrome-neutral-400 mt-0.5">{getString('settings_import_restore_desc')}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/settings/import')}><Upload size={14} />{getString('settings_import')}</Button>
          </div>
          <div className="border-t border-chrome-neutral-800/50" />
          <div className="flex items-center justify-between px-5 py-4 hover:bg-surface-container transition-colors duration-200 ease-out">
            <div className="flex-1 min-w-0 mr-4">
              <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_diagnostics')}</div>
              <div className="text-xs text-chrome-neutral-400 mt-0.5">{getString('settings_diagnostics_desc')}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/settings/diagnostics')}><FileText size={14} />{getString('settings_open')}</Button>
          </div>
          <div className="border-t border-chrome-neutral-800/50" />
          <div className="flex items-center justify-between px-5 py-4 hover:bg-surface-container transition-colors duration-200 ease-out">
            <div className="flex-1 min-w-0 mr-4">
              <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_export_data')}</div>
              <div className="text-xs text-chrome-neutral-400 mt-0.5">{getString('settings_export_data_desc')}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleExport}><Download size={14} />{getString('settings_export')}</Button>
          </div>
          <div className="border-t border-chrome-neutral-800/50" />
          <div className="flex items-center justify-between px-5 py-4 hover:bg-surface-container transition-colors duration-200 ease-out">
            <div className="flex-1 min-w-0 mr-4">
              <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_clear_cache')}</div>
              <div className="text-xs text-chrome-neutral-400 mt-0.5">{getString('settings_clear_cache_desc')}</div>
            </div>
            <Button variant="destructive" size="sm" onClick={handleClearData} disabled={clearing}><Trash2 size={14} />{clearing ? getString('settings_clearing') : getString('clear')}</Button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
