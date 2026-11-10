import { useState } from "react";

import type { RestoreDevice } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Card } from "./Card";

/** Asks which devices a restore keeps. None is ticked: the others are signed out. */
export function RestoreChoice({ devices, onRestore }: { devices: RestoreDevice[]; onRestore: (kept: string[]) => void }) {
  const { cancelRestore, busy } = useLinkedDevicesStore();
  const [kept, setKept] = useState<string[]>([]);
  return (
    <Card title={getString("linked_restore_keep_title")} subtitle={getString("linked_restore_keep_body")} className="col-span-12">
      <div className="flex flex-col gap-3">
        {devices.map((device) => (
          <Checkbox
            key={device.did}
            checked={kept.includes(device.did)}
            onChange={(checked) => setKept(checked ? [...kept, device.did] : kept.filter((did) => did !== device.did))}
          >
            <span className="text-sm text-chrome-neutral-100">
              {device.name ?? getString("linked_restore_unknown_device", device.did.slice(0, 8))}
            </span>
          </Checkbox>
        ))}
      </div>
      <p className="text-sm text-chrome-neutral-400">{getString("linked_restore_keep_link")}</p>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => onRestore(kept)}>
          {getString("linked_restore")}
        </Button>
        <Button variant="tonal" disabled={busy} onClick={cancelRestore}>
          {getString("linked_cancel")}
        </Button>
      </div>
    </Card>
  );
}
