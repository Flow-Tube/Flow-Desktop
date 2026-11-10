import { useState } from "react";

import type { LinkedDevice, LinkedStatus } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { formatYouTubeRelativeTime } from "../../../lib/publishedDate";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";
import { ConfirmedAction } from "./ConfirmedAction";

/** What the user has to know about the recovery key: it changed, or it has to. */
export function RecoveryNotices({ status, devices }: { status: LinkedStatus; devices: LinkedDevice[] }) {
  const { remove, answerRecoveryNotice, busy } = useLinkedDevicesStore();
  const [removing, setRemoving] = useState(false);
  const notice = status.recoveryNotice;
  const device = devices.find((other) => other.id === notice?.device && !other.thisDevice);
  const name = device?.name.trim() || getString("linked_recovery_notice_unknown");
  const removeDevice = async () => {
    if (device) await remove(device.id);
    await answerRecoveryNotice();
    setRemoving(false);
  };
  return (
    <>
      {status.recoveryDue && (
        <Card
          title={getString("linked_recovery_due_title")}
          subtitle={getString("linked_recovery_due_body")}
          className="col-span-12"
        >
          <ConfirmedAction
            action="replaceRecovery"
            variant="tonal"
            label={getString("linked_replace_recovery")}
            confirm={getString("linked_replace_recovery_confirm")}
          />
        </Card>
      )}
      {notice && (
        <Card
          title={getString("linked_recovery_notice_title")}
          subtitle={getString("linked_recovery_notice_body", name, formatYouTubeRelativeTime(notice.atMs))}
          className="col-span-12"
        >
          {removing && <p className="text-sm text-chrome-neutral-400">{getString("linked_remove_confirm", name)}</p>}
          <div className="flex gap-2">
            {removing ? (
              <>
                <Button variant="destructive" disabled={busy} onClick={() => void removeDevice()}>
                  {getString("linked_remove")}
                </Button>
                <Button variant="tonal" disabled={busy} onClick={() => setRemoving(false)}>
                  {getString("linked_cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="tonal" disabled={busy} onClick={() => void answerRecoveryNotice()}>
                  {getString("linked_recovery_notice_mine")}
                </Button>
                {device && (
                  <Button variant="destructive" disabled={busy} onClick={() => setRemoving(true)}>
                    {getString("linked_recovery_notice_not_mine")}
                  </Button>
                )}
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
