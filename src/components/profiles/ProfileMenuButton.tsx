import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Plus, UsersRound } from "lucide-react";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { moveMenuFocus } from "../ui/menuFocus";
import { ProfileEditorDialog } from "./ProfileEditorDialog";
import type { Profile } from "../../lib/api/profiles";
import { getString } from "../../lib/i18n/index";
import { profileDisplayName } from "../../lib/profiles/display";
import { profileErrorMessage } from "../../lib/profiles/profileErrors";
import { useProfilesStore } from "../../store/useProfilesStore";
import { useUiStore } from "../../store/useUiStore";

const ROW = "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-surface-container-highest focus-visible:bg-surface-container-highest focus-visible:outline-none disabled:opacity-50";

/** The active profile in the top bar; opens a menu to switch or manage profiles. */
export function ProfileMenuButton() {
  const view = useProfilesStore((state) => state.view);
  const load = useProfilesStore((state) => state.load);
  const switchTo = useProfilesStore((state) => state.switchTo);
  const switching = useProfilesStore((state) => state.switchingTo !== null);
  const showToast = useUiStore((state) => state.showToast);
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [creating, setCreating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!view) void load();
  }, [view, load]);

  useEffect(() => {
    if (anchor) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [anchor]);

  const active = view?.profiles.find((profile) => profile.id === view.activeId);
  const others = view?.profiles.filter((profile) => profile.id !== view.activeId) ?? [];
  const atLimit = view ? view.profiles.length >= view.maxProfiles : true;
  const activeName = active ? profileDisplayName(active) : getString("profiles_default_name");

  const close = () => setAnchor(null);
  const toggle = (button: HTMLElement) => {
    if (anchor) return close();
    const rect = button.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 8, right: rect.right });
  };
  const onSwitch = (profile: Profile) => {
    close();
    switchTo(profile).catch((reason: unknown) =>
      showToast({ message: profileErrorMessage(reason, "profiles_switch_failed"), variant: "error" }),
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (moveMenuFocus(event.currentTarget, event.key)) event.preventDefault();
  };

  const avatar = (profile: Profile, size: "md" | "lg") => (
    <ProfileAvatar
      name={profileDisplayName(profile)}
      colorKey={profile.colorKey}
      kind={profile.avatar.kind}
      emoji={profile.avatar.emoji}
      photoSrc={view?.photos[profile.id]}
      size={size}
    />
  );

  return (
    <>
      <button
        type="button"
        onClick={(event) => toggle(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={getString("profiles_avatar_button", activeName)}
        title={activeName}
        className="flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200 ease-out hover:bg-chrome-zinc-800"
      >
        {active ? avatar(active, "md") : <span className="h-8 w-8 rounded-full bg-surface-container-high" />}
      </button>

      {anchor && (
        <AnchoredPortalMenu anchor={anchor} onClose={close} className="z-[70]">
          <div
            ref={panelRef}
            role="menu"
            aria-label={getString("settings_profiles")}
            onKeyDown={onKeyDown}
            className="w-72 rounded-xl border border-chrome-neutral-800 bg-surface-container-high p-1.5 text-sm text-chrome-neutral-200"
          >
            {active && (
              <div className="flex items-center gap-3 px-2.5 py-2">
                {avatar(active, "lg")}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-chrome-neutral-100">{activeName}</p>
                  <p className="text-xs text-chrome-neutral-400">{getString("profiles_in_use")}</p>
                </div>
                <Check className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />
              </div>
            )}
            {others.map((profile) => (
              <button key={profile.id} type="button" role="menuitem" disabled={switching} onClick={() => onSwitch(profile)} className={ROW}>
                {avatar(profile, "md")}
                <span className="truncate">{profileDisplayName(profile)}</span>
              </button>
            ))}
            <div role="separator" className="mx-1.5 my-1.5 border-t border-chrome-neutral-800" />
            <button
              type="button"
              role="menuitem"
              disabled={atLimit}
              title={atLimit && view ? getString("profiles_limit_reached", view.maxProfiles) : undefined}
              onClick={() => {
                close();
                setCreating(true);
              }}
              className={ROW}
            >
              <Plus className="h-5 w-5 text-chrome-neutral-400" />
              {getString("profiles_add")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                navigate("/settings", { state: { settingsCategory: "profiles" } });
              }}
              className={ROW}
            >
              <UsersRound className="h-5 w-5 text-chrome-neutral-400" />
              {getString("profiles_manage")}
            </button>
            <p className="px-2.5 pb-1 pt-2 text-xs text-chrome-neutral-500">{getString("profiles_menu_footer")}</p>
          </div>
        </AnchoredPortalMenu>
      )}

      {creating && <ProfileEditorDialog onClose={() => setCreating(false)} />}
    </>
  );
}
