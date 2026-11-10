import { Select } from '../ui/Select';
import { SettingItem } from './SettingItem';
import { SettingsGroup } from './SettingsGroup';
import { getString } from '../../lib/i18n/index';
import { useGraphicsMode, type GraphicsMode } from '../../lib/useGraphicsMode';
import { useUiStore } from '../../store/useUiStore';

/** Linux-only: the floor for the startup GPU workarounds (linux_startup.rs). */
export function GraphicsCompatibilitySection() {
  const { mode, setMode, loading } = useGraphicsMode();
  const showToast = useUiStore((s) => s.showToast);

  const handleChange = async (value: string) => {
    const saved = await setMode(value as GraphicsMode);
    if (!saved) showToast({ variant: 'error', message: getString('settings_graphics_save_failed') });
  };

  return (
    <div className="mt-8">
      <SettingsGroup>
        <SettingItem title={getString('settings_graphics_compat')} description={getString('settings_graphics_compat_desc')}>
          <Select
            className="w-44"
            value={mode}
            disabled={loading}
            onChange={(value) => void handleChange(value)}
            options={[
              { value: 'automatic', label: getString('settings_graphics_automatic') },
              { value: 'compatible', label: getString('settings_graphics_compatible') },
              { value: 'safe', label: getString('settings_graphics_safe') },
            ]}
          />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
