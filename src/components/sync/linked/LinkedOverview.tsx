import { Link2, RefreshCw, TriangleAlert } from "lucide-react";

import type { LinkedStatus } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { formatYouTubeRelativeTime } from "../../../lib/publishedDate";
import { syncErrorMessage } from "../../../lib/syncErrors";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { useSyncActivityStore } from "../../../store/useSyncActivityStore";
import { Button } from "../../ui/Button";
import { Spinner } from "../SyncParts";
import { Card } from "./Card";
import { DeviceList } from "./DeviceList";
import { JoinRequests } from "./JoinRequests";
import { LeaveGroup } from "./LeaveGroup";

function lastSyncText(status: LinkedStatus, syncing: boolean): string {
  if (syncing) return getString("linked_syncing");
  const last = status.lastSync;
  if (!last) return getString("linked_never_synced");
  if (last.error) return getString("linked_sync_failed", syncErrorMessage(last.error, null));
  return getString("linked_last_sync", formatYouTubeRelativeTime(last.atMs));
}

const STORE_TITLES = { server: "linked_server", webdav: "linked_webdav", lan: "linked_on_lan" } as const;

/** For a device in a group: where it lives, the last sync, and the devices it syncs with. */
export function LinkedOverview({ status }: { status: LinkedStatus }) {
  const { devices, devicesError, busy, syncNow, addDevice, refresh } = useLinkedDevicesStore();
  const syncing = useSyncActivityStore((state) => state.syncing);
  return (
    <div className="grid grid-cols-12 gap-4">
      {status.kind === "server" && <JoinRequests />}
      <Card title={getString(STORE_TITLES[status.kind ?? "server"])} className="col-span-12 lg:col-span-5">
        {status.kind === "lan" ? (
          <p className="text-sm text-chrome-neutral-400">{getString("linked_on_lan_body")}</p>
        ) : (
          <p className="break-all font-mono text-sm text-chrome-neutral-100">{status.storeUrl}</p>
        )}
        <p className={`text-sm ${status.lastSync?.error ? "text-chrome-red-400" : "text-chrome-neutral-400"}`}>
          {lastSyncText(status, syncing)}
        </p>
        {!status.recoverySaved && (
          <p className="flex gap-2 text-sm text-chrome-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {getString("linked_recovery_unsaved")}
          </p>
        )}
        <Button variant="tonal" className="mt-auto self-start" disabled={busy || syncing} onClick={() => void syncNow()}>
          <RefreshCw className={`h-4 w-4 ${busy || syncing ? "animate-spin" : ""}`} /> {getString("linked_sync_now")}
        </Button>
        <LeaveGroup action="leave" label={getString("linked_leave")} confirm={getString("linked_leave_confirm")} />
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
