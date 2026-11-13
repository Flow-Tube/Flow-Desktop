import { useState } from "react";

import type { SyncedProfile } from "../../../lib/api/linked";
import type { Profile } from "../../../lib/api/profiles";
import { getString } from "../../../lib/i18n/index";
import { useLinkedProfiles } from "../../../lib/linked/useLinkedProfiles";
import { profileDisplayName } from "../../../lib/profiles/display";
import { profileErrorMessage } from "../../../lib/profiles/profileErrors";
import { useDashboardStore } from "../../../store/useDashboardStore";
import { useProfilesStore } from "../../../store/useProfilesStore";
import { Button } from "../../ui/Button";
import { ProfileAvatar } from "../../ui/ProfileAvatar";
import { Select } from "../../ui/Select";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingItem } from "../../settings/SettingItem";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Spinner } from "../SyncParts";

const NEW_LINK = "";

function syncedName(profile: SyncedProfile): string {
  return profile.name.trim() || getString("linked_profile_unnamed");
}

type Controls = ReturnType<typeof useLinkedProfiles>;

/** One profile here: whether it syncs, how it starts, and how it stops. A profile's data goes
 * out only while it runs, so one that isn't running switches before it can start. */
function ProfileRow({
  profile,
  link,
  running,
  synced,
  controls,
}: {
  profile: Profile;
  link: string | null;
  running: boolean;
  synced: SyncedProfile[];
  controls: Controls;
}) {
  const photo = useProfilesStore((state) => state.view?.photos[profile.id]);
  const switchTo = useProfilesStore((state) => state.switchTo);
  const switching = useProfilesStore((state) => state.switchingTo !== null);
  const [choosing, setChoosing] = useState<"start" | "stop" | null>(null);
  const [joining, setJoining] = useState(NEW_LINK);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const name = profileDisplayName(profile);
  // Updates for a profile that isn't running wait until the user switches to it.
  const kept = useDashboardStore((state) => (link ? state.dashboard?.profiles.find((p) => p.link === link)?.kept : 0) ?? 0);

  const onSwitch = () => {
    setSwitchError(null);
    switchTo(profile).catch((reason: unknown) => setSwitchError(profileErrorMessage(reason, "profiles_switch_failed")));
  };

  const onToggle = (on: boolean) => {
    if (on && synced.length === 0) void controls.start(profile.id, null);
    else setChoosing(on ? "start" : "stop");
  };
  const finish = (action: Promise<void>) => void action.then(() => setChoosing(null));

  return (
    <div className="flex flex-col gap-3 px-5 py-4 transition-colors duration-200 ease-out hover:bg-surface-row-hover">
      <div className="flex items-center gap-3">
        <ProfileAvatar
          name={name}
          colorKey={profile.colorKey}
          kind={profile.avatar.kind}
          emoji={profile.avatar.emoji}
          photoSrc={photo}
        />
        <div className="min-w-0 flex-1">
          <div dir="auto" className="truncate text-sm font-medium text-chrome-neutral-200">{name}</div>
          <div className="text-xs text-chrome-neutral-400">
            {kept > 0 ? getString("linked_dashboard_kept", kept) : getString(link ? "linked_profile_syncs" : "linked_profile_local")}
          </div>
        </div>
        {link === null && !running ? (
          <Button size="sm" variant="tonal" disabled={controls.busy || switching} onClick={onSwitch}>
            {getString("linked_profile_switch_to_sync")}
          </Button>
        ) : (
          <ToggleSwitch checked={link !== null} disabled={controls.busy} onChange={onToggle} />
        )}
      </div>
      {switchError && <p className="ps-12 text-sm text-chrome-red-400">{switchError}</p>}
      {choosing === "start" && (
        <div className="flex flex-wrap items-center gap-2 ps-12">
          <span className="text-sm text-chrome-neutral-400">{getString("linked_profile_as")}</span>
          <Select
            value={joining}
            onChange={setJoining}
            options={[
              { value: NEW_LINK, label: getString("linked_profile_new") },
              ...synced.map((s) => ({ value: s.link, label: getString("linked_profile_join", syncedName(s)) })),
            ]}
          />
          <Button size="sm" disabled={controls.busy} onClick={() => finish(controls.start(profile.id, joining || null))}>
            {getString("linked_profile_sync")}
          </Button>
          <Button size="sm" variant="tonal" onClick={() => setChoosing(null)}>
            {getString("cancel")}
          </Button>
        </div>
      )}
      {choosing === "stop" && link && (
        <div className="flex flex-wrap items-center gap-2 ps-12">
          <Button size="sm" variant="tonal" disabled={controls.busy} onClick={() => finish(controls.stop(profile.id))}>
            {getString("linked_profile_stop_here")}
          </Button>
          <Button size="sm" variant="tonal" disabled={controls.busy} onClick={() => finish(controls.deleteEverywhere(link))}>
            {getString("linked_profile_stop_everywhere")}
          </Button>
          <Button size="sm" variant="tonal" onClick={() => setChoosing(null)}>
            {getString("cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Which of this computer's profiles sync with the group, and the ones only other devices have. */
export function ProfilesGroup() {
  const view = useProfilesStore((state) => state.view);
  const controls = useLinkedProfiles();
  const { profiles, error, busy } = controls;
  const title = getString("linked_profiles_title");
  const errorRow = error && <SettingItem title={getString("linked_profiles_error", error)} titleClassName="text-chrome-red-400" />;

  if (!profiles || !view) {
    return (
      <SettingsGroup title={title}>
        {errorRow || (
          <div className="px-5 py-4">
            <Spinner className="h-5 w-5 text-chrome-neutral-400" />
          </div>
        )}
      </SettingsGroup>
    );
  }

  if (profiles.chooseForDefault) {
    return (
      <SettingsGroup title={title}>
        <SettingItem title={getString("linked_profiles_choose")}>
          <div className="flex flex-wrap justify-end gap-2">
            {profiles.synced.map((synced) => (
              <Button key={synced.link} size="sm" variant="tonal" disabled={busy} onClick={() => void controls.choose(synced.link)}>
                {syncedName(synced)}
              </Button>
            ))}
            <Button size="sm" variant="tonal" disabled={busy} onClick={() => void controls.choose(null)}>
              {getString("linked_profile_start_new")}
            </Button>
          </div>
        </SettingItem>
        {errorRow}
      </SettingsGroup>
    );
  }

  const full = view.profiles.length >= view.maxProfiles;
  return (
    <>
      <SettingsGroup title={title}>
        {profiles.local.map((local) => {
          const profile = view.profiles.find((p) => p.id === local.id);
          return profile ? (
            <ProfileRow
              key={local.id}
              profile={profile}
              link={local.link ?? null}
              running={local.id === view.activeId}
              synced={profiles.synced}
              controls={controls}
            />
          ) : null;
        })}
        {errorRow}
      </SettingsGroup>
      {profiles.synced.length > 0 && (
        <SettingsGroup title={getString("linked_profile_others")}>
          {profiles.synced.map((synced) => (
            <SettingItem
              key={synced.link}
              title={syncedName(synced)}
              description={full ? getString("profiles_limit_reached", view.maxProfiles) : undefined}
            >
              <Button size="sm" variant="tonal" disabled={busy || full} onClick={() => void controls.addHere(syncedName(synced), synced.link)}>
                {getString("linked_profile_add_here")}
              </Button>
            </SettingItem>
          ))}
        </SettingsGroup>
      )}
    </>
  );
}
