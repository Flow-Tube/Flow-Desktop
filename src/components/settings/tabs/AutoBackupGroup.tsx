import { FolderOpen, DatabaseBackup } from 'lucide-react';

import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { useAutoBackup, type BackUpOutcome } from '../../../lib/backup/useAutoBackup';
import { pickFolder } from '../../../lib/dialogs';
import { getString } from '../../../lib/i18n/index';
import { usePreference } from '../../../lib/usePreference';
import { SETTINGS } from '../../../lib/settings/schema';
import { useProfilesStore } from '../../../store/useProfilesStore';
import { useUiStore } from '../../../store/useUiStore';

const OUTCOME_MESSAGES: Record<BackUpOutcome, { message: Parameters<typeof getString>[0]; variant: 'success' | 'error' }> = {
  done: { message: 'settings_backup_done', variant: 'success' },
  busy: { message: 'settings_backup_busy', variant: 'error' },
  folder_missing: { message: 'settings_backup_folder_missing', variant: 'error' },
  failed: { message: 'settings_backup_failed', variant: 'error' },
};

export function AutoBackupGroup() {
  const showToast = useUiStore((state) => state.showToast);
  const profileCount = useProfilesStore((state) => state.view?.profiles.length ?? 1);
  const [frequency, setFrequency] = usePreference(SETTINGS.AUTO_BACKUP_FREQUENCY, 'NONE');
  const [backupType, setBackupType] = usePreference(SETTINGS.AUTO_BACKUP_TYPE, 'APP_DATA');
  const [folder, setFolder] = usePreference(SETTINGS.AUTO_BACKUP_FOLDER, '');
  const { status, backingUp, backUpNow } = useAutoBackup();

  const scopeDescriptions: Record<string, string> = {
    APP_DATA: getString('settings_backup_scope_app_data_desc'),
    BRAIN: getString('settings_backup_scope_brain_desc'),
    MASTER: getString('settings_backup_scope_master_desc'),
  };

  const chooseFolder = async () => {
    const chosen = await pickFolder(getString('settings_backup_pick_folder'));
    if (chosen) setFolder(chosen);
  };

  const runNow = async () => {
    const { message, variant } = OUTCOME_MESSAGES[await backUpNow()];
    showToast({ message: getString(message), variant });
  };

  const lastRun = status.lastRunMs > 0 ? new Date(status.lastRunMs).toLocaleString() : null;

  return (
    <SettingsGroup title={getString('settings_group_auto_backup')}>
      <SettingItem title={getString('settings_backup_frequency')} description={getString('settings_backup_frequency_desc')}>
        <Select value={frequency} onChange={setFrequency} options={[
          { value: 'NONE', label: getString('settings_option_disabled') }, { value: 'DAILY', label: getString('settings_backup_daily') },
          { value: 'WEEKLY', label: getString('settings_backup_weekly') }, { value: 'MONTHLY', label: getString('settings_backup_monthly') },
        ]} />
      </SettingItem>
      <SettingItem
        title={getString('settings_backup_scope')}
        description={profileCount > 1 ? getString('settings_backup_all_profiles') : scopeDescriptions[backupType] ?? getString('settings_backup_scope_desc')}
      >
        <Select value={backupType} onChange={setBackupType} options={[
          { value: 'APP_DATA', label: getString('settings_backup_scope_app_data') }, { value: 'BRAIN', label: getString('settings_backup_scope_brain') }, { value: 'MASTER', label: getString('settings_backup_scope_master') },
        ]} />
      </SettingItem>
      <SettingItem title={getString('settings_backup_folder')} description={folder || getString('settings_backup_no_folder')}>
        <Button variant="secondary" size="sm" onClick={chooseFolder}><FolderOpen size={14} />{getString('settings_backup_pick_folder')}</Button>
      </SettingItem>
      {(lastRun || status.lastError) && (
        <SettingItem
          title={getString('settings_backup_last_run')}
          description={status.lastError ? getString(status.lastError === 'folder_missing' ? 'settings_backup_folder_missing' : 'settings_backup_failed') : undefined}
        >
          {lastRun && <span className="text-sm text-chrome-neutral-300">{lastRun}</span>}
        </SettingItem>
      )}
      <SettingItem title={getString('settings_backup_run_now')} description={getString('settings_backup_run_now_desc')}>
        <Button variant="secondary" size="sm" onClick={runNow} disabled={backingUp || !folder}><DatabaseBackup size={14} />{backingUp ? getString('settings_backup_running') : getString('settings_backup_run_now')}</Button>
      </SettingItem>
    </SettingsGroup>
  );
}
