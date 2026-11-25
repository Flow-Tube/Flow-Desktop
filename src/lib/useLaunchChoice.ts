import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** The stored value if it is one of `values`, else `fallback`. */
export function toLaunchChoice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.find((choice) => choice === value) ?? fallback;
}

/**
 * A Linux graphics choice that the backend reads once at launch, before the window exists, so it
 * applies on the next start. `setChoice` resolves false and restores the previous value when the
 * backend write fails.
 */
export function useLaunchChoice<T extends string>(
  commands: { get: string; set: string; arg: string },
  values: readonly T[],
  fallback: T,
) {
  const [choice, setChoiceState] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    invoke<string>(commands.get)
      .then((value) => {
        if (active) setChoiceState(toLaunchChoice(value, values, fallback));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [commands.get, values, fallback]);

  const setChoice = useCallback(
    async (next: T): Promise<boolean> => {
      const previous = choice;
      setChoiceState(next);
      try {
        await invoke(commands.set, { [commands.arg]: next });
        return true;
      } catch {
        setChoiceState(previous);
        return false;
      }
    },
    [choice, commands.set, commands.arg],
  );

  return { choice, setChoice, loading };
}
