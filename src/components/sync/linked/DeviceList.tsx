import { useState } from "react";
import { Monitor, Pencil, Smartphone, Trash2 } from "lucide-react";

import type { LinkedDevice } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";

function displayName(device: LinkedDevice): string {
  return device.name.trim() || getString("linked_device_unnamed");
}

function DeviceRow({ device }: { device: LinkedDevice }) {
  const { rename, remove, busy } = useLinkedDevicesStore();
  const [mode, setMode] = useState<"view" | "rename" | "remove">("view");
  const [name, setName] = useState(device.name);
  const Icon = device.platform === "android" ? Smartphone : Monitor;

  if (mode === "rename") {
    const save = async () => {
      await rename(device.id, name);
      setMode("view");
    };
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <Icon className="h-5 w-5 shrink-0 text-chrome-neutral-400" />
        <TextInput value={name} onChange={setName} maxLength={64} className="min-w-0 flex-1" autoFocus />
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
          {getString("linked_save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
          {getString("linked_cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 ease-out hover:bg-surface-container">
      <Icon className="h-5 w-5 shrink-0 text-chrome-neutral-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-chrome-neutral-100">{displayName(device)}</p>
        {mode === "remove" && (
          <p className="text-xs text-chrome-neutral-400">{getString("linked_remove_confirm", displayName(device))}</p>
        )}
      </div>
      {(device.thisDevice || device.nearby) && (
        <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs text-chrome-neutral-300">
          {getString(device.thisDevice ? "linked_this_device" : "linked_nearby")}
        </span>
      )}
      {mode === "remove" ? (
        <>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove(device.id)}>
            {getString("linked_remove")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
            {getString("linked_cancel")}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="ghost" aria-label={getString("linked_rename")} onClick={() => setMode("rename")}>
            <Pencil className="h-4 w-4" />
          </Button>
          {!device.thisDevice && (
            <Button size="sm" variant="ghost" aria-label={getString("linked_remove")} onClick={() => setMode("remove")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function DeviceList({ devices }: { devices: LinkedDevice[] }) {
  return (
    <div className="flex flex-col divide-y divide-chrome-neutral-800/50 overflow-hidden rounded-xl border border-chrome-neutral-800/50">
      {devices.map((device) => (
        <DeviceRow key={device.id} device={device} />
      ))}
    </div>
  );
}
