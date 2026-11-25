import { confirmAction } from "./dialogs";
import { getString } from "./i18n/index";
import { useSearchHistoryStore } from "../store/useSearchHistoryStore";

/**
 * Clears every saved search once the user says yes. The same question wherever Clear sits,
 * since a misclick beside the recent searches would otherwise lose them all with their filters.
 */
export async function clearSearchHistoryAfterAsking(): Promise<boolean> {
  const confirmed = await confirmAction({
    title: getString("settings_clear_search_history"),
    message: getString("settings_clear_search_history_confirm"),
    confirmLabel: getString("clear"),
    destructive: true,
  });
  if (confirmed) useSearchHistoryStore.getState().clear();
  return confirmed;
}
