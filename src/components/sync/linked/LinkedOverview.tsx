import { FolderKey, HardDrive, KeyRound, LogOut, Plus, RefreshCw, Server, ShieldAlert, ShieldCheck, Wifi } from "lucide-react";

import type { LinkedStatus } from "../../../lib/api/linked";
import { formatBytes } from "../../../lib/downloadOptions";
import { joinIsolated } from "../../../lib/direction";
import { getString } from "../../../lib/i18n/index";
import { useGroupDashboard } from "../../../lib/linked/useGroupDashboard";
import { formatYouTubeRelativeTime } from "../../../lib/publishedDate";
import { syncErrorMessage } from "../../../lib/syncErrors";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { useSyncActivityStore } from "../../../store/useSyncActivityStore";
import { SettingItem } from "../../settings/SettingItem";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Button } from "../../ui/Button";
import { Spinner } from "../SyncParts";
import { ConfirmedActionRow } from "./ConfirmedAction";
import { DeviceList } from "./DeviceList";
import { JoinRequests } from "./JoinRequests";
import { LoginChange } from "./LoginChange";
import { ProfilesGroup } from "./ProfilesGroup";
import { RecoveryNotices } from "./RecoveryNotices";

const ICON = "h-5 w-5";
const STORE_TITLES = { server: "linked_server", webdav: "linked_webdav", lan: "linked_on_lan" } as const;
const STORE_ICONS = { server: Server, webdav: FolderKey, lan: Wifi } as const;

function lastSyncText(status: LinkedStatus, syncing: boolean): string {
  if (syncing) return getString("linked_syncing");
  const last = status.lastSync;
  if (!last) return getString("linked_never_synced");
  if (last.error) return getString("linked_sync_failed", syncErrorMessage(last.error, null));
  return getString("linked_last_sync", formatYouTubeRelativeTime(last.atMs));
}

const bytes = (value: number) => formatBytes(value) ?? "0 MB";

/** Where the group lives, when this device last synced, and a way to sync now. */
function StatusRow({ status }: { status: LinkedStatus }) {
  const { busy, syncNow } = useLinkedDevicesStore();
  const syncing = useSyncActivityStore((state) => state.syncing);
  const kind = status.kind ?? "server";
  const StoreIcon = STORE_ICONS[kind];
  const failed = Boolean(status.lastSync?.error) && !syncing;
  return (
    <SettingsGroup>
      <SettingItem
        icon={<StoreIcon className={`${ICON} ${failed ? "text-chrome-red-400" : ""}`} />}
        title={kind === "lan" ? getString(STORE_TITLES.lan) : joinIsolated([getString(STORE_TITLES[kind]), status.storeUrl])}
        description={lastSyncText(status, syncing)}
      >
        <Button size="sm" variant="tonal" disabled={busy || syncing} onClick={() => void syncNow()}>
          <RefreshCw className={`h-4 w-4 ${busy || syncing ? "animate-spin" : ""}`} /> {getString("linked_sync_now")}
        </Button>
      </SettingItem>
    </SettingsGroup>
  );
}

function DevicesGroup() {
  const { devices, devicesError, busy, addDevice, refresh } = useLinkedDevicesStore();
  const title = getString("linked_devices_label");
  const addRow = (
    <SettingItem
      icon={<Plus className={`${ICON} text-primary`} />}
      title={getString("linked_add_device")}
      description={getString("linked_add_device_desc")}
      titleClassName="text-primary"
      disabled={busy}
      onSelect={() => void addDevice()}
    />
  );
  if (devicesError) {
    return (
      <SettingsGroup title={title}>
        <SettingItem title={getString("linked_devices_error", devicesError)} titleClassName="text-chrome-red-400">
          <Button size="sm" variant="tonal" onClick={() => void refresh()}>
            {getString("linked_retry")}
          </Button>
        </SettingItem>
        {addRow}
      </SettingsGroup>
    );
  }
  if (!devices) {
    return (
      <SettingsGroup title={title}>
        <div className="px-5 py-4">
          <Spinner className="h-5 w-5 text-chrome-neutral-400" />
        </div>
      </SettingsGroup>
    );
  }
  return (
    <DeviceList devices={devices} title={title}>
      {addRow}
    </DeviceList>
  );
}

/** The group itself: its recovery words, its storage, recent errors, and leaving it. */
function GroupSettings({ status }: { status: LinkedStatus }) {
  const devices = useLinkedDevicesStore((state) => state.devices);
  const dashboard = useGroupDashboard();
  const storage = dashboard?.storage;
  const latestError = dashboard?.errors[0];
  return (
    <SettingsGroup title={getString("linked_group_section")}>
      <ConfirmedActionRow
        action="replaceRecovery"
        variant="tonal"
        icon={<KeyRound className={`${ICON} ${status.recoverySaved ? "" : "text-chrome-amber-400"}`} />}
        title={getString("linked_recovery_words")}
        description={getString(status.recoverySaved ? "linked_recovery_saved_desc" : "linked_recovery_unsaved")}
        titleClassName={status.recoverySaved ? undefined : "text-chrome-amber-400"}
        label={getString("linked_replace")}
        confirm={getString("linked_replace_recovery_confirm")}
      />
      {storage && (
        <SettingItem
          icon={<HardDrive className={ICON} />}
          title={getString("linked_dashboard_storage")}
          description={joinIsolated([
            getString("linked_dashboard_used", bytes(storage.used), bytes(storage.quota)),
            getString("linked_dashboard_objects", storage.objects),
            dashboard.server && getString(dashboard.server.live ? "linked_dashboard_live_on" : "linked_dashboard_live_off"),
          ])}
        >
          {storage.quota > 0 && (
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-container-high">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(1, storage.used / storage.quota) * 100}%` }} />
            </div>
          )}
        </SettingItem>
      )}
      {dashboard && (
        <SettingItem
          icon={latestError ? <ShieldAlert className={`${ICON} text-chrome-red-400`} /> : <ShieldCheck className={ICON} />}
          title={getString("linked_dashboard_errors")}
          description={
            latestError
              ? joinIsolated([syncErrorMessage(latestError.kind, null), formatYouTubeRelativeTime(latestError.atMs)])
              : getString("linked_dashboard_no_errors")
          }
        />
      )}
      <ConfirmedActionRow
        action="leave"
        icon={<LogOut className={`${ICON} text-chrome-red-400`} />}
        title={getString("linked_leave")}
        description={getString("linked_leave_desc")}
        label={getString("linked_leave_button")}
        confirm={
          devices?.some((device) => device.thisDevice && device.setRecoveryKey)
            ? `${getString("linked_leave_confirm")} ${getString("linked_leave_stops_others")}`
            : getString("linked_leave_confirm")
        }
      />
    </SettingsGroup>
  );
}

/** For a device in a group: its status, anything waiting on the user, devices, profiles and the group. */
export function LinkedOverview({ status }: { status: LinkedStatus }) {
  const devices = useLinkedDevicesStore((state) => state.devices);
  return (
    <div className="flex flex-col gap-6">
      <StatusRow status={status} />
      <div className="grid grid-cols-12 gap-4 empty:hidden">
        <RecoveryNotices status={status} devices={devices ?? []} />
        {status.kind === "server" && <JoinRequests />}
        {status.kind === "webdav" && <LoginChange status={status} devices={devices ?? []} />}
      </div>
      <DevicesGroup />
      <ProfilesGroup />
      <GroupSettings status={status} />
    </div>
  );
}
