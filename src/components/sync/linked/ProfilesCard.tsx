import { useState } from "react";

import type { SyncedProfile } from "../../../lib/api/linked";
import type { Profile } from "../../../lib/api/profiles";
import { getString } from "../../../lib/i18n/index";
import { useLinkedProfiles } from "../../../lib/linked/useLinkedProfiles";
import { profileDisplayName } from "../../../lib/profiles/display";
import { profileErrorMessage } from "../../../lib/profiles/profileErrors";
import { useProfilesStore } from "../../../store/useProfilesStore";
import { Button } from "../../ui/Button";
import { ProfileAvatar } from "../../ui/ProfileAvatar";
import { Select } from "../../ui/Select";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Spinner } from "../SyncParts";
import { Card } from "./Card";

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ProfileAvatar
          name={name}
          colorKey={profile.colorKey}
          kind={profile.avatar.kind}
          emoji={profile.avatar.emoji}
          photoSrc={photo}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-chrome-neutral-200">{name}</div>
          <div className="text-xs text-chrome-neutral-400">
            {getString(link ? "linked_profile_syncs" : "linked_profile_local")}
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
      {switchError && <p className="pl-12 text-sm text-chrome-red-400">{switchError}</p>}
      {choosing === "start" && (
        <div className="flex flex-wrap items-center gap-2 pl-12">
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
        <div className="flex flex-wrap items-center gap-2 pl-12">
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
export function ProfilesCard({ className = "" }: { className?: string }) {
  const view = useProfilesStore((state) => state.view);
  const controls = useLinkedProfiles();
  const { profiles, error, busy } = controls;
  const title = getString("linked_profiles_title");

  if (!profiles || !view) {
    return (
      <Card title={title} className={className}>
        {error ? (
          <p className="text-sm text-chrome-red-400">{getString("linked_profiles_error", error)}</p>
        ) : (
          <Spinner className="h-5 w-5 text-chrome-neutral-400" />
        )}
      </Card>
    );
  }

  if (profiles.chooseForDefault) {
    return (
      <Card title={title} subtitle={getString("linked_profiles_choose")} className={className}>
        <div className="flex flex-wrap gap-2">
          {profiles.synced.map((synced) => (
            <Button key={synced.link} variant="tonal" disabled={busy} onClick={() => void controls.choose(synced.link)}>
              {syncedName(synced)}
            </Button>
          ))}
          <Button variant="tonal" disabled={busy} onClick={() => void controls.choose(null)}>
            {getString("linked_profile_start_new")}
          </Button>
        </div>
        {error && <p className="text-sm text-chrome-red-400">{error}</p>}
      </Card>
    );
  }

  const full = view.profiles.length >= view.maxProfiles;
  return (
    <Card title={title} subtitle={getString("linked_profiles_subtitle")} className={className}>
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
      {profiles.synced.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-chrome-neutral-800 pt-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("linked_profile_others")}
          </span>
          {profiles.synced.map((synced) => (
            <div key={synced.link} className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-chrome-neutral-200">{syncedName(synced)}</span>
              <Button
                size="sm"
                variant="tonal"
                disabled={busy || full}
                onClick={() => void controls.addHere(syncedName(synced), synced.link)}
              >
                {getString("linked_profile_add_here")}
              </Button>
            </div>
          ))}
          {full && <p className="text-xs text-chrome-neutral-500">{getString("profiles_limit_reached", view.maxProfiles)}</p>}
        </div>
      )}
      {error && <p className="text-sm text-chrome-red-400">{error}</p>}
    </Card>
  );
}
