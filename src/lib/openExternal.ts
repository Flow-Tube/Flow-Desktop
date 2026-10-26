import { isTauriEnv } from './api/env';
import { invokeBackend } from './api/errors';
import { copyText } from './clipboard';
import { recordDiagnostic } from './diagnostics';
import { getString } from './i18n/index';
import { useUiStore } from '../store/useUiStore';

/** Opens a web or mail link outside Flow. Resolves false when nothing opened it. */
export async function openExternal(url: string): Promise<boolean> {
  if (!(await isTauriEnv())) return window.open(url, '_blank', 'noopener,noreferrer') !== null;
  try {
    await invokeBackend<void>('open_external', { url });
    return true;
  } catch (error) {
    recordDiagnostic('external', `open failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Opens a link, and when no browser starts, offers to copy it instead. */
export async function openExternalOrOfferCopy(url: string): Promise<void> {
  if (await openExternal(url)) return;
  useUiStore.getState().showToast({
    variant: 'error',
    message: getString('open_external_failed'),
    durationMs: 6000,
    action: { label: getString('open_external_copy_link'), onSelect: () => void copyText(url) },
  });
}
