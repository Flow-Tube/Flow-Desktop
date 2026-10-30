import { isTauriEnv } from './api/env';
import { useConfirmStore, type ConfirmRequest } from '../store/useConfirmStore';

export async function pickFolder(title: string): Promise<string | null> {
  if (await isTauriEnv()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title });
      return typeof selected === 'string' ? selected : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function pickFile(
  title: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  if (await isTauriEnv()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ title, multiple: false, directory: false, filters });
      return typeof selected === 'string' ? selected : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function pickSaveFile(
  title: string,
  defaultName: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  if (await isTauriEnv()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({ title, defaultPath: defaultName, filters });
      return typeof selected === 'string' ? selected : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Asks a yes/no question in the app's own dialog. Never use `window.confirm`: the Tauri dialog
 * plugin replaces it with an async version, so its result is a Promise that always reads as yes.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().ask(request);
}
