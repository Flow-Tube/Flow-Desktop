import { Select } from '../ui/Select';
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
    <section className="mt-8 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-medium text-chrome-neutral-200">{getString('settings_graphics_compat')}</h2>
        <p className="mt-1 text-sm text-chrome-neutral-400">{getString('settings_graphics_compat_desc')}</p>
      </div>
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
    </section>
  );
}
