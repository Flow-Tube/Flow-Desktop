import { useCallback, useEffect, useState } from "react";
import {
  createThemeFile,
  getThemeFileState,
  onThemeFileChanged,
  revealThemeFile,
  watchThemeFile,
  type ThemeFileState,
} from "./api/themeFile";
import { logToBackend } from "./diagnostics";
import { buildThemeFileTheme } from "./themeFile";
import { applyThemeFileCss, readRootToken, removeThemeFileCss, resolveCssColor } from "./themeFileStyle";
import { useThemeFileStore } from "../store/useThemeFileStore";

function applyThemeFile(state: ThemeFileState) {
  const store = useThemeFileStore.getState();
  store.setFile(state);
  // A missing or unreadable version keeps the last good one, so a tool that
  // deletes and rewrites the file never flashes Flow back to its defaults.
  if (state.status !== "loaded" || state.css === null) return;
  const removedRemote = applyThemeFileCss(state.css);
  store.setApplied({ ...buildThemeFileTheme(readRootToken, resolveCssColor), removedRemote });
}

/** Loads, applies and watches the theme file while it is the chosen theme. */
export function useThemeFileSync(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const accept = (state: ThemeFileState) => {
      if (!disposed) applyThemeFile(state);
    };
    const fail = (action: string) => (cause: unknown) => {
      void logToBackend("warn", `theme file ${action} failed`, { cause: String(cause) });
    };
    const unlisten = onThemeFileChanged(accept);
    getThemeFileState().then(accept, fail("read"));
    watchThemeFile(true).catch(fail("watch"));
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
      watchThemeFile(false).catch(fail("unwatch"));
      removeThemeFileCss();
      useThemeFileStore.getState().setApplied(null);
    };
  }, [active]);
}

/** The theme file's state for Settings, with the actions offered there. */
export function useThemeFile() {
  const file = useThemeFileStore((state) => state.file);
  const applied = useThemeFileStore((state) => state.applied);
  const setFile = useThemeFileStore((state) => state.setFile);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    try {
      setError(null);
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, []);

  useEffect(() => {
    void run(getThemeFileState).then((state) => {
      if (state) setFile(state);
    });
  }, [run, setFile]);

  const create = useCallback(async () => {
    const state = await run(createThemeFile);
    if (state) setFile(state);
    return state;
  }, [run, setFile]);

  const reveal = useCallback(() => run(revealThemeFile), [run]);

  return { file, applied, error, create, reveal };
}
