import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { LyricsProviderList } from '../LyricsProviderList';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import {
  getOrderedProviders,
  parseProviderEnabledStates,
  serializeProviderEnabledStates,
} from '../../../lib/lyrics/registry';
import { serializeProviderOrder } from '../../../lib/lyrics/providerOrder';
import { formatCacheSize, useLyricsCache } from '../../../lib/lyrics/useLyricsCache';

export function MusicLyricsSettings() {
  const [providerOrder, setProviderOrder] = usePreference(SETTINGS.LYRICS_PROVIDER_ORDER, '');
  const [enabledRaw, setEnabledRaw] = usePreference(SETTINGS.LYRICS_PROVIDER_ENABLED_STATES, '{}');
  const [align, setAlign] = usePreference(SETTINGS.LYRICS_TEXT_ALIGN);
  const [showTranslation, setShowTranslation] = useBoolPref(SETTINGS.LYRICS_SHOW_TRANSLATION);
  const [showRomanization, setShowRomanization] = useBoolPref(SETTINGS.LYRICS_SHOW_ROMANIZATION);
  const cache = useLyricsCache();

  const providers = getOrderedProviders(providerOrder);
  const enabledStates = parseProviderEnabledStates(enabledRaw);
  const enabledCount = providers.filter((provider) => enabledStates[provider.name] !== false).length;
  const setProviderEnabled = (providerName: string, enabled: boolean) => {
    setEnabledRaw(serializeProviderEnabledStates({ ...enabledStates, [providerName]: enabled }));
  };

  return (
    <SettingsGroup title={getString('settings_group_lyrics')}>
      <SettingItem title={getString('lyrics_alignment')}>
        <Select value={align} onChange={setAlign} options={[
          { value: 'left', label: getString('lyrics_align_left') },
          { value: 'center', label: getString('lyrics_align_center') },
          { value: 'right', label: getString('lyrics_align_right') },
        ]} />
      </SettingItem>
      <SettingItem title={getString('lyrics_show_translation')} description={getString('lyrics_show_translation_summary')}>
        <ToggleSwitch checked={showTranslation} onChange={setShowTranslation} />
      </SettingItem>
      <SettingItem title={getString('lyrics_show_romanization')} description={getString('lyrics_show_romanization_summary')}>
        <ToggleSwitch checked={showRomanization} onChange={setShowRomanization} />
      </SettingItem>
      <SettingItem
        title={getString('settings_lyrics_providers')}
        description={`${enabledCount} / ${providers.length} ${getString('settings_lyrics_providers_enabled')}`}
      >
        <span className="text-xs font-medium text-chrome-neutral-400">
          {getString('settings_lyrics_ordered')}
        </span>
      </SettingItem>
      <LyricsProviderList
        order={providers.map((provider) => provider.name)}
        isEnabled={(name) => enabledStates[name] !== false}
        onReorder={(order) => setProviderOrder(serializeProviderOrder(order))}
        onToggle={setProviderEnabled}
      />
      <SettingItem
        title={getString('settings_lyrics_cache')}
        description={
          cache.failed
            ? getString('settings_lyrics_cache_clear_failed')
            : cache.sizeBytes === null
              ? getString('settings_lyrics_cache_desc')
              : getString('settings_lyrics_cache_size', formatCacheSize(cache.sizeBytes))
        }
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={cache.clearing || cache.sizeBytes === 0}
          onClick={() => void cache.clear()}
        >
          {getString('settings_lyrics_cache_clear')}
        </Button>
      </SettingItem>
    </SettingsGroup>
  );
}
