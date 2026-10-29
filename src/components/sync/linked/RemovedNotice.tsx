import { getString } from "../../../lib/i18n/index";
import { Card } from "./Card";
import { LeaveGroup } from "./LeaveGroup";

/** Shown once another device removed this one: the only thing left is to stop syncing here. */
export function RemovedNotice() {
  return (
    <Card title={getString("linked_removed_title")} subtitle={getString("linked_removed_body")}>
      <LeaveGroup label={getString("linked_forget")} confirm={getString("linked_forget_confirm")} />
    </Card>
  );
}
