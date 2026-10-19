import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** Linux startup workaround floor; see src-tauri/src/linux_startup.rs. */
export const GRAPHICS_MODES = ['automatic', 'compatible', 'safe'] as const;
export type GraphicsMode = (typeof GRAPHICS_MODES)[number];

export function toGraphicsMode(value: unknown): GraphicsMode {
  return GRAPHICS_MODES.find((mode) => mode === value) ?? 'automatic';
}

/**
 * The Linux graphics compatibility mode. It applies on the next launch, since
 * GTK reads the workaround variables before the window exists. `setMode`
 * resolves false and restores the previous mode when the backend write fails.
 */
export function useGraphicsMode() {
  const [mode, setModeState] = useState<GraphicsMode>('automatic');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    invoke<string>('get_graphics_mode')
      .then((value) => {
        if (active) setModeState(toGraphicsMode(value));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback(
    async (next: GraphicsMode): Promise<boolean> => {
      const previous = mode;
      setModeState(next);
      try {
        await invoke('set_graphics_mode', { mode: next });
        return true;
      } catch {
        setModeState(previous);
        return false;
      }
    },
    [mode],
  );

  return { mode, setMode, loading };
}
