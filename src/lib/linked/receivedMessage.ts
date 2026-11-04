import type { Received } from "../api/linked";
import { getString } from "../i18n/index";

/** "Received N changes from <device>", shown after a sync the user asked for. */
export function receivedMessage({ name, count }: Received): string {
  const from = name.trim() || getString("linked_another_device");
  return count === 1 ? getString("linked_received_one", from) : getString("linked_received_many", count, from);
}
