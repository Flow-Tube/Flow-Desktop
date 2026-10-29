import { getString } from "../../../lib/i18n/index";
import type { LinkedStatus } from "../../../lib/api/linked";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";
import { LeaveGroup } from "./LeaveGroup";

/**
 * Shown once the group shut this device out. A removal it verified already forgot the group;
 * a server that refuses it leaves forgetting to the user.
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
  return (
    <Card title={getString("linked_refused_title")} subtitle={getString("linked_refused_body")}>
      <LeaveGroup action="forget" label={getString("linked_forget")} confirm={getString("linked_forget_confirm")} />
    </Card>
  );
}
