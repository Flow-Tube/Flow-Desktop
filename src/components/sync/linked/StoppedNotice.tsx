import { getString } from "../../../lib/i18n/index";
import type { LinkedStatus } from "../../../lib/api/linked";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";
import { ConfirmedAction } from "./ConfirmedAction";

/**
 * Shown once the group shut this device out. A removal that extended what it had applied already
 * forgot the group; a server that refuses it, or a roster that replaced what it had applied, leaves
 * forgetting to the user.
 */
export function StoppedNotice({ reason }: { reason: NonNullable<LinkedStatus["stopped"]> }) {
  const { forget, busy } = useLinkedDevicesStore();
  if (reason === "linkedRemoved") {
    return (
      <Card title={getString("linked_removed_title")} subtitle={getString("linked_removed_body")}>
        <Button variant="tonal" className="self-start" disabled={busy} onClick={() => void forget()}>
          {getString("linked_removed_done")}
        </Button>
      </Card>
    );
  }
  if (reason === "linkedRemovalUnconfirmed") {
    return (
      <Card title={getString("linked_unconfirmed_title")} subtitle={getString("linked_unconfirmed_body")}>
        <ConfirmedAction action="forget" label={getString("linked_forget")} confirm={getString("linked_forget_confirm")} />
      </Card>
    );
  }
  return (
    <Card title={getString("linked_refused_title")} subtitle={getString("linked_refused_body")}>
      <ConfirmedAction action="forget" label={getString("linked_forget")} confirm={getString("linked_forget_confirm")} />
    </Card>
  );
}
