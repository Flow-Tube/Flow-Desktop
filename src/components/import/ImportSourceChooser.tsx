import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';

import { SettingsGroup } from '../settings/SettingsGroup';
import { SettingItem } from '../settings/SettingItem';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { IMPORT_SOURCES, type ImportOption } from '../../lib/backup/importSources';
import { importFailureMessage, importReportSummary, runOtherAppImport } from '../../lib/backup/otherAppImport';
import { pickFile, pickFiles } from '../../lib/dialogs';
import { getString } from '../../lib/i18n/index';
import { useUiStore } from '../../store/useUiStore';

export function ImportSourceChooser({ disabled }: { disabled: boolean }) {
  const showToast = useUiStore((state) => state.showToast);
  const [sourceId, setSourceId] = useState(IMPORT_SOURCES[0]?.id ?? '');
  const [running, setRunning] = useState<string | null>(null);
  const source = IMPORT_SOURCES.find((candidate) => candidate.id === sourceId) ?? IMPORT_SOURCES[0];

  const run = async (option: ImportOption) => {
    const title = getString(option.title);
    const filters = [{ name: title, extensions: option.extensions }];
    const paths = option.several ? await pickFiles(title, filters) : [await pickFile(title, filters)].flatMap((path) => path ?? []);
    if (paths.length === 0) return;
    setRunning(option.kind);
    try {
      const outcome = await runOtherAppImport(option.kind, paths);
      if (outcome.type === 'done') showToast({ message: importReportSummary(outcome.report), variant: 'success' });
      else showToast({ message: importFailureMessage(outcome.reason), variant: 'error' });
    } catch (error) {
      console.error('Import failed', error);
      showToast({ message: importFailureMessage('failed'), variant: 'error' });
    } finally {
      setRunning(null);
    }
  };

  return (
    <SettingsGroup title={getString('import_from_app_title')}>
      <SettingItem title={getString('import_from_app_label')} description={getString('import_from_app_desc')}>
        <Select
          value={sourceId}
          onChange={setSourceId}
          options={IMPORT_SOURCES.map((candidate) => ({ value: candidate.id, label: getString(candidate.title) }))}
        />
      </SettingItem>
      {source?.options.map((option) => (
        <SettingItem key={option.kind} title={getString(option.title)} description={getString(option.description)}>
          <Button variant="secondary" size="sm" onClick={() => run(option)} disabled={disabled || running !== null}>
            {running === option.kind ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {running === option.kind ? getString('import_running') : getString('import_choose')}
          </Button>
        </SettingItem>
      ))}
    </SettingsGroup>
  );
}
