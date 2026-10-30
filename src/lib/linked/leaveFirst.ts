import { isTauriEnv } from "../api/env";
import { normalizeBackendError } from "../api/errors";
import { forgetGroup, getLinkedStatus, leaveGroup } from "../api/linked";
import { confirmAction } from "../dialogs";
import { getString } from "../i18n/index";
import { syncErrorMessage } from "../syncErrors";

/**
 * When leaving failed for `error`, says why and offers to forget the group on this device anyway.
 * Resolves whether it was forgotten.
 */
export async function forgetAfterFailedLeave(error: unknown): Promise<boolean> {
  const { kind, message } = normalizeBackendError(error);
  const reason = syncErrorMessage(kind, message);
  const confirmed = await confirmAction(
    `${getString("linked_leave_failed", reason)}\n\n${getString("linked_forget_anyway_body")}`,
    getString("linked_forget_anyway"),
  );
  if (confirmed) await forgetGroup();
  return confirmed;
}

/**
 * Before a reset in the profile that syncs: leaves the group, or, when that fails, offers to forget
 * it on this device anyway. Resolves false when the user keeps the group, so nothing is reset.
 */
export async function leaveGroupFirst(): Promise<boolean> {
  if (!(await isTauriEnv()) || !(await getLinkedStatus()).kind) return true;
  try {
    await leaveGroup();
    return true;
  } catch (error) {
    return forgetAfterFailedLeave(error);
  }
}
