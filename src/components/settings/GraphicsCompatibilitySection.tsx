import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { SettingItem } from './SettingItem';
import { SettingsGroup } from './SettingsGroup';
import { getString } from '../../lib/i18n/index';
import { getGraphicsReport } from '../../lib/graphicsReport';
import { startGraphicsTrial } from '../../lib/graphicsTrial';
import { useGraphicsMode, type GraphicsMode } from '../../lib/useGraphicsMode';
import { useUiStore } from '../../store/useUiStore';

/** Linux-only: the floor for the startup GPU workarounds (linux_startup.rs), and a way back down from them. */
export function GraphicsCompatibilitySection() {
  const { mode, setMode, loading } = useGraphicsMode();
  const showToast = useUiStore((s) => s.showToast);
  const [canTryFaster, setCanTryFaster] = useState(false);

  useEffect(() => {
    let active = true;
    void getGraphicsReport().then((report) => {
      if (active) setCanTryFaster(report?.faster === 'available' || report?.faster === 'suggested');
    });
    return () => {
      active = false;
    };
  }, []);

  const handleChange = async (value: string) => {
    const saved = await setMode(value as GraphicsMode);
    if (!saved) showToast({ variant: 'error', message: getString('settings_graphics_save_failed') });
  };

  const handleTryFaster = async () => {
    const started = await startGraphicsTrial();
    if (!started) showToast({ variant: 'error', message: getString('settings_graphics_try_faster_failed') });
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
        {canTryFaster && (
          <SettingItem title={getString('graphics_try_faster')} description={getString('settings_graphics_try_faster_desc')}>
            <Button variant="secondary" size="sm" onClick={() => void handleTryFaster()}>
              {getString('graphics_try_faster')}
            </Button>
          </SettingItem>
        )}
      </SettingsGroup>
    </div>
  );
}
