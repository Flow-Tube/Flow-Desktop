import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Download, Trash2, FileText } from 'lucide-react';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Button } from '../../ui/Button';
import { usePreference } from '../../../lib/usePreference';
import { saveBackupFile } from '../../../lib/backup/exportFile';
import type { BackupFileKind } from '../../../lib/api/backup';
import { getPlural, getString } from '../../../lib/i18n/index';
import { AutoBackupGroup } from './AutoBackupGroup';
import { getSetting, resetAppData, getWatchHistory } from '../../../lib/api/db';
import { confirmAction } from '../../../lib/dialogs';
import { leaveGroupFirst } from '../../../lib/linked/leaveFirst';
import { SETTINGS } from '../../../lib/settings/schema';
import { useUiStore } from '../../../store/useUiStore';

export function DataTab() {
  const navigate = useNavigate();
  const showToast = useUiStore((state) => state.showToast);
  const [backupType] = usePreference(SETTINGS.AUTO_BACKUP_TYPE, 'APP_DATA');
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
    const confirmed = await confirmAction({
      title: getString('settings_clear_confirm_title'),
      message: getString('settings_clear_confirm_body'),
      confirmLabel: getString('clear'),
      destructive: true,
    });
    if (!confirmed) return;
    setClearing(true);
    try {
      if (!(await leaveGroupFirst())) return;
      await resetAppData();
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

  const handleExport = async (kind: BackupFileKind, title: string) => {
    try {
      const result = await saveBackupFile(kind, title);
      if (!result) return;
      const message = result.skipped > 0 ? getPlural('settings_export_newpipe_skipped', result.skipped) : getString('settings_export_success');
      showToast({ message, variant: 'success' });
    } catch (e) {
      console.error('Export failed', e);
      showToast({ message: getString('settings_export_failed'), variant: 'error' });
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <AutoBackupGroup />

      <SettingsGroup title={getString('settings_group_database')}>
        <SettingItem title={getString('settings_history_records')}><span className="text-sm font-mono text-chrome-neutral-100">{historyCount}</span></SettingItem>
        <SettingItem title={getString('settings_subscriptions_count')}><span className="text-sm font-mono text-chrome-neutral-100">{subCount}</span></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_actions')}>
        <SettingItem title={getString('settings_import_restore')} description={getString('settings_import_restore_desc')}>
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings/import')}><Upload size={14} />{getString('settings_import')}</Button>
        </SettingItem>
        <SettingItem title={getString('settings_diagnostics')} description={getString('settings_diagnostics_desc')}>
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings/diagnostics')}><FileText size={14} />{getString('settings_open')}</Button>
        </SettingItem>
        <SettingItem title={getString('settings_export_data')} description={getString('settings_export_data_desc')}>
          <Button variant="secondary" size="sm" onClick={() => handleExport(backupType as BackupFileKind, getString('settings_export_data'))}><Download size={14} />{getString('settings_export')}</Button>
        </SettingItem>
        <SettingItem title={getString('settings_export_history')} description={getString('settings_export_history_desc')}>
          <Button variant="secondary" size="sm" onClick={() => handleExport('WATCH_HISTORY', getString('settings_export_history'))}><Download size={14} />{getString('settings_export')}</Button>
        </SettingItem>
        <SettingItem title={getString('settings_export_newpipe')} description={getString('settings_export_newpipe_desc')}>
          <Button variant="secondary" size="sm" onClick={() => handleExport('NEWPIPE_SUBSCRIPTIONS', getString('settings_export_newpipe'))}><Download size={14} />{getString('settings_export')}</Button>
        </SettingItem>
        <SettingItem title={getString('settings_clear_cache')} description={getString('settings_clear_cache_desc')}>
          <Button variant="destructive" size="sm" onClick={handleClearData} disabled={clearing}><Trash2 size={14} />{clearing ? getString('settings_clearing') : getString('clear')}</Button>
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
