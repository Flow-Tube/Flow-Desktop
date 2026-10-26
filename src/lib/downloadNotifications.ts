import { showDownloadNotification } from "./api/downloads";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

/** A system notification for a download that ended while Flow was in the
 *  background, when the user wants them. */
export function notifyDownloadInBackground(title: string, body: string): void {
  const enabled = useAppSettingsStore.getState().values[SETTINGS.DOWNLOAD_NOTIFICATIONS] !== "false";
  if (!enabled || document.hasFocus()) return;
  void showDownloadNotification(title, body).catch(() => {});
}
