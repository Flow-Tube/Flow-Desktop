import { useState } from "react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";

/** Leaves the group, or only forgets it, after the user confirms `confirm`. */
export function LeaveGroup({ action, label, confirm }: { action: "leave" | "forget"; label: string; confirm: string }) {
  const store = useLinkedDevicesStore();
  const { busy } = store;
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {confirming && <p className="text-sm text-chrome-neutral-400">{confirm}</p>}
      <div className="flex gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => (confirming ? void store[action]() : setConfirming(true))}>
          {label}
        </Button>
        {confirming && (
          <Button variant="tonal" disabled={busy} onClick={() => setConfirming(false)}>
            {getString("linked_cancel")}
          </Button>
        )}
      </div>
    </>
  );
}
