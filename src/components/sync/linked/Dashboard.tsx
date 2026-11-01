import { useEffect } from "react";
import { Link } from "react-router-dom";

import type { Dashboard as DashboardData, SyncedProfileState } from "../../../lib/api/linked";
import { onSynced } from "../../../lib/api/linked";
import { isTauriEnv } from "../../../lib/api/env";
import { formatBytes } from "../../../lib/downloadOptions";
import { getString } from "../../../lib/i18n/index";
import { profileDisplayName } from "../../../lib/profiles/display";
import { formatYouTubeRelativeTime } from "../../../lib/publishedDate";
import { syncErrorMessage } from "../../../lib/syncErrors";
import { useDashboardStore } from "../../../store/useDashboardStore";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { useProfilesStore } from "../../../store/useProfilesStore";
import { ProfileAvatar } from "../../ui/ProfileAvatar";
import { Spinner } from "../SyncParts";
import { Card } from "./Card";
import { DeviceList } from "./DeviceList";
import { STORE_TITLES } from "./LinkedOverview";

const bytes = (value: number) => formatBytes(value) ?? "0 MB";

function StoreCard({ dashboard }: { dashboard: DashboardData }) {
  return (
    <Card title={getString("linked_dashboard_store")} className="col-span-12 lg:col-span-5">
      <p className="text-sm font-medium text-chrome-neutral-200">{getString(STORE_TITLES[dashboard.kind])}</p>
      {dashboard.storeUrl && <p className="break-all font-mono text-sm text-chrome-neutral-400">{dashboard.storeUrl}</p>}
      {dashboard.server && (
        <>
          <p className="text-sm text-chrome-neutral-400">
            {getString("linked_dashboard_protocols", dashboard.server.protocols.join(", "))}
          </p>
          <p className="text-sm text-chrome-neutral-400">
            {getString(dashboard.server.live ? "linked_dashboard_live_on" : "linked_dashboard_live_off")}
          </p>
        </>
      )}
    </Card>
  );
}

function StorageCard({ storage }: { storage: DashboardData["storage"] }) {
  const share = storage && storage.quota > 0 ? Math.min(1, storage.used / storage.quota) : 0;
  return (
    <Card title={getString("linked_dashboard_storage")} className="col-span-12 lg:col-span-7">
      {storage ? (
        <>
          <p className="text-sm text-chrome-neutral-200">
            {getString("linked_dashboard_used", bytes(storage.used), bytes(storage.quota))}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
            <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="text-sm text-chrome-neutral-400">{getString("linked_dashboard_objects", storage.objects)}</p>
        </>
      ) : (
        <p className="text-sm text-chrome-neutral-400">{getString("linked_dashboard_storage_unknown")}</p>
      )}
    </Card>
  );
}

function ProfileStateRow({ state }: { state: SyncedProfileState }) {
  const view = useProfilesStore((s) => s.view);
  const profile = view?.profiles.find((p) => p.id === state.profile);
  if (!profile) return null;
  const name = profileDisplayName(profile);
  return (
    <div className="flex items-center gap-3">
      <ProfileAvatar
        name={name}
        colorKey={profile.colorKey}
        kind={profile.avatar.kind}
        emoji={profile.avatar.emoji}
        photoSrc={view?.photos[profile.id]}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-chrome-neutral-200">{name}</div>
        <div className="text-xs text-chrome-neutral-400">
          {state.kept > 0 ? getString("linked_dashboard_kept", state.kept) : getString("linked_dashboard_up_to_date")}
        </div>
        <div className="text-xs text-chrome-neutral-500">
          {state.ownSnapshotMs
            ? getString("linked_dashboard_snapshot", formatYouTubeRelativeTime(state.ownSnapshotMs))
            : getString("linked_dashboard_no_snapshot")}
        </div>
      </div>
      <Link
        to={profile.id === view?.activeId ? "/feed" : `/feed?profile=${encodeURIComponent(profile.id)}`}
        className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-colors duration-200 ease-out hover:bg-surface-container-high"
      >
        {getString("linked_dashboard_view_interests")}
      </Link>
    </div>
  );
}

function ErrorsCard({ errors }: { errors: DashboardData["errors"] }) {
  return (
    <Card title={getString("linked_dashboard_errors")} className="col-span-12 lg:col-span-5">
      {errors.length === 0 ? (
        <p className="text-sm text-chrome-neutral-400">{getString("linked_dashboard_no_errors")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {errors.map((error) => (
            <li key={`${error.atMs}-${error.kind}`} className="flex justify-between gap-3 text-sm">
              <span className="text-chrome-neutral-200">{syncErrorMessage(error.kind, null)}</span>
              <span className="shrink-0 text-chrome-neutral-500">{formatYouTubeRelativeTime(error.atMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The group at a glance: where it lives, its storage, devices, synced profiles and recent errors. */
export function Dashboard() {
  const { dashboard, error, load } = useDashboardStore();
  const devices = useLinkedDevicesStore((state) => state.devices);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void load();
    void isTauriEnv().then(async (tauri) => {
      if (!tauri) return;
      const unlisten = await onSynced(() => void load());
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [load]);

  if (!dashboard) {
    return error ? (
      <p className="text-sm text-chrome-red-400">{getString("linked_dashboard_error", error)}</p>
    ) : (
      <Spinner className="h-5 w-5 text-chrome-neutral-400" />
    );
  }
  return (
    <div className="grid grid-cols-12 gap-4">
      <StoreCard dashboard={dashboard} />
      <StorageCard storage={dashboard.storage} />
      <Card title={getString("linked_devices_label")} className="col-span-12 lg:col-span-7">
        {devices ? <DeviceList devices={devices} /> : <Spinner className="h-5 w-5 text-chrome-neutral-400" />}
      </Card>
      <ErrorsCard errors={dashboard.errors} />
      <Card title={getString("linked_dashboard_profiles")} className="col-span-12">
        {dashboard.profiles.map((state) => (
          <ProfileStateRow key={state.link} state={state} />
        ))}
      </Card>
    </div>
  );
}
