import { useState } from "react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";

/** Shown once another device removed this one: the only thing left is to stop syncing here. */
export function RemovedNotice() {
  const { forget, busy } = useLinkedDevicesStore();
  const [confirming, setConfirming] = useState(false);
  return (
    <Card title={getString("linked_removed_title")} subtitle={getString("linked_removed_body")}>
      {confirming && <p className="text-sm text-chrome-neutral-400">{getString("linked_forget_confirm")}</p>}
      <Button
        variant="destructive"
        className="self-start"
        disabled={busy}
        onClick={() => (confirming ? void forget() : setConfirming(true))}
      >
        {getString("linked_forget")}
      </Button>
    </Card>
  );
}
