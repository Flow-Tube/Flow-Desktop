import { Trash2 } from 'lucide-react';

import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import type { CacheKind, CacheRow } from '../../../lib/api/cache';
import { useCacheUsage } from '../../../lib/cache/useCacheUsage';
import { formatBytes } from '../../../lib/downloadOptions';
import { getString, type StringKey } from '../../../lib/i18n/index';
import { formatCacheSize } from '../../../lib/lyrics/useLyricsCache';
import { useUiStore } from '../../../store/useUiStore';

const COPY: Record<CacheKind, { title: StringKey; description: StringKey; limits: number[] }> = {
  artwork: { title: 'settings_cache_artwork', description: 'settings_cache_artwork_desc', limits: [100, 200, 500, 1000, 2000, 0] },
  lyrics: { title: 'settings_cache_lyrics', description: 'settings_cache_lyrics_desc', limits: [20, 50, 100, 200, 0] },
  network: { title: 'settings_cache_network', description: 'settings_cache_network_desc', limits: [50, 100, 200, 500, 0] },
};

const limitLabel = (megabytes: number) =>
  megabytes === 0 ? getString('settings_option_unlimited') : megabytes >= 1000 ? `${megabytes / 1000} GB` : `${megabytes} MB`;

function describe(row: CacheRow | undefined, kind: CacheKind, clearPending: boolean): string {
  const description = getString(COPY[kind].description);
  if (!row) return `${description}. ${getString('settings_cache_measuring')}`;
  const used = row.bytes < 1024 ** 2 ? formatCacheSize(row.bytes) : formatBytes(row.bytes);
  const size = row.limitMb === 0
    ? getString('settings_cache_used_no_limit', used)
    : getString('settings_cache_used_of_limit', used, limitLabel(row.limitMb));
  const notes = kind === 'artwork' ? [clearPending ? getString('settings_cache_clear_pending') : getString('settings_cache_limit_on_restart')] : [];
  return [description, size, ...notes].join('. ');
}

export function CacheGroup() {
  const showToast = useUiStore((state) => state.showToast);
  const { usage, busy, clear, changeLimit } = useCacheUsage();
  const clearPending = usage?.artworkClearPending ?? false;

  const onClear = async (kind: CacheKind) => {
    if (!(await clear(kind))) showToast({ message: getString('settings_cache_clear_failed'), variant: 'error' });
  };

  const onLimit = async (kind: CacheKind, value: string) => {
    if (!(await changeLimit(kind, Number(value)))) showToast({ message: getString('settings_cache_limit_failed'), variant: 'error' });
  };

  return (
    <SettingsGroup title={getString('settings_group_cache')}>
      {(Object.keys(COPY) as CacheKind[]).map((kind) => {
        const row = usage?.rows.find((candidate) => candidate.kind === kind);
        return (
          <SettingItem key={kind} title={getString(COPY[kind].title)} description={describe(row, kind, clearPending)}>
            <div className="flex items-center gap-2">
              <Select
                value={String(row?.limitMb ?? 0)}
                onChange={(value) => void onLimit(kind, value)}
                disabled={!row || busy === kind}
                options={COPY[kind].limits.map((limit) => ({ value: String(limit), label: limitLabel(limit) }))}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onClear(kind)}
                disabled={!row || busy === kind || row.bytes === 0 || (kind === 'artwork' && clearPending)}
              >
                <Trash2 size={14} />{getString('clear')}
              </Button>
            </div>
          </SettingItem>
        );
      })}
    </SettingsGroup>
  );
}
