import { useState } from "react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";

type Action = "leave" | "forget" | "replaceRecovery";

/** Runs a group action after the user confirms `confirm`. */
export function ConfirmedAction({
  action,
  label,
  confirm,
  variant = "destructive",
}: {
  action: Action;
  label: string;
  confirm: string;
  variant?: "destructive" | "tonal";
}) {
  const store = useLinkedDevicesStore();
  const { busy } = store;
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {confirming && <p className="text-sm text-chrome-neutral-400">{confirm}</p>}
      <div className="flex gap-2">
        <Button variant={variant} disabled={busy} onClick={() => (confirming ? void store[action]() : setConfirming(true))}>
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
