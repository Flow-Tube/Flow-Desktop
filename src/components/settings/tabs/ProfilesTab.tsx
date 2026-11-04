import { useEffect, useState } from "react";
import { Loader2, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { MediaMenu } from "../../ui/MediaMenu";
import { ProfileAvatar } from "../../ui/ProfileAvatar";
import { SkeletonLoader } from "../../ui/SkeletonLoader";
import type { MenuAnchor } from "../../ui/AnchoredPortalMenu";
import { SettingsGroup } from "../SettingsGroup";
import { ProfileEditorDialog } from "../../profiles/ProfileEditorDialog";
import type { Profile } from "../../../lib/api/profiles";
import { confirmAction } from "../../../lib/dialogs";
import { getString } from "../../../lib/i18n/index";
import { profileDisplayName } from "../../../lib/profiles/display";
import { profileErrorMessage } from "../../../lib/profiles/profileErrors";
import { useProfilesStore } from "../../../store/useProfilesStore";
import { useUiStore } from "../../../store/useUiStore";

type Editing = { profile?: Profile } | null;

function ProfileRow({ profile, onEdit }: { profile: Profile; onEdit: (profile: Profile) => void }) {
  const view = useProfilesStore((state) => state.view);
  const switchTo = useProfilesStore((state) => state.switchTo);
  const switching = useProfilesStore((state) => state.switchingTo !== null);
  const remove = useProfilesStore((state) => state.remove);
  const showToast = useUiStore((state) => state.showToast);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  const isActive = profile.id === view?.activeId;
  const isDefault = profile.id === view?.defaultId;
  const name = profileDisplayName(profile);
  const description = isActive ? getString("profiles_in_use") : isDefault ? getString("profiles_syncs") : null;

  const onSwitch = () => {
    switchTo(profile).catch((reason: unknown) =>
      showToast({ message: profileErrorMessage(reason, "profiles_switch_failed"), variant: "error" }),
    );
  };

  const onDelete = async () => {
    const confirmed = await confirmAction({
      message: getString("profiles_delete_body"),
      title: getString("profiles_delete_title", name),
      confirmLabel: getString("profiles_delete"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await remove(profile.id);
      showToast({ message: getString("profiles_deleted", name), variant: "success" });
    } catch (reason) {
      showToast({ message: profileErrorMessage(reason, "profiles_delete_failed"), variant: "error" });
    }
  };

  const openMenu = (button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setMenu({ top: rect.bottom + 4, right: rect.right, flipBottom: rect.top - 4 });
  };

  return (
    <div className="flex items-center gap-3 px-5 py-3 transition-colors duration-200 ease-out hover:bg-surface-container">
      <ProfileAvatar
        name={name}
        colorKey={profile.colorKey}
        kind={profile.avatar.kind}
        emoji={profile.avatar.emoji}
        photoSrc={view?.photos[profile.id]}
        size="lg"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-chrome-neutral-200">{name}</div>
        {description && <div className="mt-0.5 text-xs text-chrome-neutral-400">{description}</div>}
      </div>
      {!isActive && (
        <Button variant="tonal" size="sm" onClick={onSwitch} disabled={switching}>
          {getString("profiles_switch")}
        </Button>
      )}
      <IconButton aria-label={getString("profiles_more", name)} onClick={(event) => openMenu(event.currentTarget)}>
        <MoreVertical className="h-5 w-5" />
      </IconButton>
      {menu && (
        <MediaMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          actions={[
            { id: "edit", label: getString("profiles_edit"), icon: <Pencil size={18} />, group: "library", onSelect: () => onEdit(profile) },
            ...(isActive || isDefault
              ? []
              : [{ id: "delete", label: getString("profiles_delete"), icon: <Trash2 size={18} />, group: "library" as const, danger: true, onSelect: onDelete }]),
          ]}
        />
      )}
    </div>
  );
}

export function ProfilesTab() {
  const view = useProfilesStore((state) => state.view);
  const loading = useProfilesStore((state) => state.loading);
  const loadError = useProfilesStore((state) => state.loadError);
  const load = useProfilesStore((state) => state.load);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const atLimit = view ? view.profiles.length >= view.maxProfiles : true;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("settings_profiles")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-chrome-neutral-400">{getString("profiles_footer")}</p>
      </div>

      <SettingsGroup
        title={
          view
            ? `${getString("profiles_on_device")} · ${getString("profiles_count", view.profiles.length, view.maxProfiles)}`
            : getString("profiles_on_device")
        }
      >
        {!view && loading &&
          [0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3 px-5 py-3">
              <SkeletonLoader className="h-10 w-10 rounded-full" />
              <SkeletonLoader className="h-4 w-40 rounded-md" />
            </div>
          ))}
        {!view && !loading && loadError && (
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm text-chrome-neutral-400">{getString("profiles_load_failed")}</span>
            <Button variant="tonal" size="sm" onClick={() => void load()}>
              {getString("profiles_retry")}
            </Button>
          </div>
        )}
        {view?.profiles.map((profile) => (
          <ProfileRow key={profile.id} profile={profile} onEdit={(item) => setEditing({ profile: item })} />
        ))}
      </SettingsGroup>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => setEditing({})} disabled={atLimit}>
          {loading && !view ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {getString("profiles_add")}
        </Button>
        {view && atLimit && (
          <span className="text-xs text-chrome-neutral-400">{getString("profiles_limit_reached", view.maxProfiles)}</span>
        )}
      </div>

      {editing && <ProfileEditorDialog profile={editing.profile} onClose={() => setEditing(null)} />}
    </div>
  );
}
