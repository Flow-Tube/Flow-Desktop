import { useEffect } from 'react';
import { FolderOpen, FolderPlus, X } from 'lucide-react';

import type { LocalMediaFolder } from '../../lib/api/localMedia';
import { getPlural, getString } from '../../lib/i18n/index';
import { SETTINGS } from '../../lib/settings/schema';
import { useBoolPref, useNumberPref } from '../../lib/usePreference';
import { useLocalMediaStore } from '../../store/useLocalMediaStore';
import { useUiStore } from '../../store/useUiStore';
import { Select } from '../ui/Select';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { SettingItem } from './SettingItem';
import { SettingsGroup } from './SettingsGroup';

const MIN_AUDIO_CHOICES = [0, 10, 30, 60];
const ADD_BUTTON = 'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-chrome-neutral-200 bg-surface-container-high hover:bg-surface-container-highest rounded-md border border-chrome-neutral-700 transition-colors duration-200 ease-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function FolderRows({ folders }: { folders: LocalMediaFolder[] }) {
  const removeFolder = useLocalMediaStore((s) => s.removeFolder);
  if (folders.length === 0) return null;
  const remove = (path: string) => {
    void removeFolder(path).catch(() =>
      useUiStore.getState().showToast({ variant: 'error', message: getString('settings_local_media_remove_failed') }),
    );
  };
  return (
    <div className="px-3 pb-3">
      {folders.map((folder) => (
        <div key={folder.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-200 ease-out hover:bg-surface-container">
          <FolderOpen className="h-4 w-4 shrink-0 text-chrome-neutral-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-chrome-neutral-200" title={folder.path}>{folder.path}</span>
          <button
            type="button"
            onClick={() => remove(folder.path)}
            aria-label={getString('settings_local_media_remove', folder.path)}
            className="shrink-0 rounded-full p-1 text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function LocalMediaSettings() {
  const folders = useLocalMediaStore((s) => s.folders);
  const load = useLocalMediaStore((s) => s.load);
  const addFolder = useLocalMediaStore((s) => s.addFolder);
  const [hideRecordings, setHideRecordings] = useBoolPref(SETTINGS.LOCAL_MEDIA_HIDE_RECORDINGS);
  const [minAudio, setMinAudio] = useNumberPref(SETTINGS.LOCAL_MEDIA_MIN_AUDIO_SECONDS);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SettingsGroup title={getString('settings_group_local_media')}>
      <SettingItem title={getString('settings_local_media_folders')} description={getString('settings_local_media_folders_desc')}>
        <button type="button" className={ADD_BUTTON} onClick={() => void addFolder(getString('local_media_pick_folder_title'), false)}>
          <FolderPlus size={14} />
          {getString('settings_local_media_add')}
        </button>
      </SettingItem>
      <FolderRows folders={folders.filter((folder) => folder.role === 'include')} />
      <SettingItem title={getString('settings_local_media_excluded')} description={getString('settings_local_media_excluded_desc')}>
        <button type="button" className={ADD_BUTTON} onClick={() => void addFolder(getString('settings_local_media_exclude_title'), true)}>
          <FolderPlus size={14} />
          {getString('settings_local_media_add')}
        </button>
      </SettingItem>
      <FolderRows folders={folders.filter((folder) => folder.role === 'exclude')} />
      <SettingItem title={getString('settings_local_media_hide_recordings')} description={getString('settings_local_media_hide_recordings_desc')}>
        <ToggleSwitch checked={hideRecordings} onChange={setHideRecordings} />
      </SettingItem>
      <SettingItem title={getString('settings_local_media_min_audio')}>
        <Select
          value={String(minAudio)}
          onChange={(value) => setMinAudio(Number(value))}
          options={MIN_AUDIO_CHOICES.map((seconds) => ({
            value: String(seconds),
            label: seconds === 0 ? getString('settings_local_media_min_audio_off') : getPlural('settings_local_media_seconds', seconds),
          }))}
        />
      </SettingItem>
    </SettingsGroup>
  );
}
