import { useState } from "react";
import { Monitor, Pencil, Smartphone, Trash2 } from "lucide-react";

import type { LinkedDevice } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useConsents, type Consent } from "../../../lib/live/useConsents";
import { formatYouTubeRelativeTime } from "../../../lib/publishedDate";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { TextInput } from "../../ui/TextInput";

function displayName(device: LinkedDevice): string {
  return device.name.trim() || getString("linked_device_unnamed");
}

const CONSENTS: Consent[] = ["ask", "allow", "decline"];
const CONSENT_LABELS = {
  ask: "linked_consent_ask",
  allow: "linked_consent_allow",
  decline: "linked_consent_decline",
} as const;

interface RowProps {
  device: LinkedDevice;
  consent: Consent;
  onConsent: (consent: Consent) => void;
}

function DeviceRow({ device, consent, onConsent }: RowProps) {
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
        {device.lastSyncMs != null && mode !== "remove" && (
          <p className="text-xs text-chrome-neutral-400">
            {getString("linked_device_synced", formatYouTubeRelativeTime(device.lastSyncMs))}
          </p>
        )}
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
            <Select
              value={consent}
              onChange={(value) => onConsent(value as Consent)}
              options={CONSENTS.map((value) => ({ value, label: getString(CONSENT_LABELS[value]) }))}
              className="w-44"
            />
          )}
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
  const [consents, setConsent] = useConsents();
  return (
    <div className="flex flex-col divide-y divide-chrome-neutral-800/50 overflow-hidden rounded-xl border border-chrome-neutral-800/50">
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          consent={consents[device.id] ?? "ask"}
          onConsent={(consent) => setConsent(device.id, consent)}
        />
      ))}
    </div>
  );
}
