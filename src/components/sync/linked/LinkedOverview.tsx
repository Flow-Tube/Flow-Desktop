import { Link2, RefreshCw, TriangleAlert } from "lucide-react";

import type { LinkedStatus } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { formatYouTubeRelativeTime } from "../../../lib/publishedDate";
import { syncErrorMessage } from "../../../lib/syncErrors";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Spinner } from "../SyncParts";
import { Card } from "./Card";
import { DeviceList } from "./DeviceList";
import { LeaveGroup } from "./LeaveGroup";

function lastSyncText(status: LinkedStatus): string {
  const last = status.lastSync;
  if (!last) return getString("linked_never_synced");
  if (last.error) return getString("linked_sync_failed", syncErrorMessage(last.error, null));
  return getString("linked_last_sync", formatYouTubeRelativeTime(last.atMs));
}

/** For a device in a group: its server, the last sync, and the devices it syncs with. */
export function LinkedOverview({ status }: { status: LinkedStatus }) {
  const { devices, devicesError, busy, syncNow, addDevice, refresh } = useLinkedDevicesStore();
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card title={getString("linked_server")} className="col-span-12 lg:col-span-5">
        <p className="break-all font-mono text-sm text-chrome-neutral-100">{status.storeUrl}</p>
        <p className={`text-sm ${status.lastSync?.error ? "text-chrome-red-400" : "text-chrome-neutral-400"}`}>
          {lastSyncText(status)}
        </p>
        {!status.recoverySaved && (
          <p className="flex gap-2 text-sm text-chrome-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {getString("linked_recovery_unsaved")}
          </p>
        )}
        <Button variant="tonal" className="mt-auto self-start" disabled={busy} onClick={() => void syncNow()}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {getString("linked_sync_now")}
        </Button>
        <LeaveGroup label={getString("linked_leave")} confirm={getString("linked_leave_confirm")} />
      </Card>
      <Card title={getString("linked_devices_label")} className="col-span-12 lg:col-span-7">
        {devicesError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-chrome-red-400">{getString("linked_devices_error", devicesError)}</p>
            <Button size="sm" variant="tonal" onClick={() => void refresh()}>
              {getString("linked_retry")}
            </Button>
          </div>
        ) : devices ? (
          <DeviceList devices={devices} />
        ) : (
          <Spinner className="h-5 w-5 text-chrome-neutral-400" />
        )}
        <Button className="mt-auto self-start" disabled={busy} onClick={() => void addDevice()}>
          <Link2 className="h-4 w-4" /> {getString("linked_add_device")}
        </Button>
      </Card>
    </div>
  );
}
