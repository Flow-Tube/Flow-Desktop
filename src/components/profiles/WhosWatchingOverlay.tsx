import type { Profile } from "../../lib/api/profiles";
import { getString } from "../../lib/i18n/index";
import { profileDisplayName } from "../../lib/profiles/display";
import { profileErrorMessage } from "../../lib/profiles/profileErrors";
import { useLaunchProfileQuestion } from "../../lib/profiles/useLaunchProfileQuestion";
import { useProfilesStore } from "../../store/useProfilesStore";
import { useUiStore } from "../../store/useUiStore";
import { ProfileAvatar } from "../ui/ProfileAvatar";

/** With two or more profiles, chooses one as the app opens. Escape stays on the one already open. */
export function WhosWatchingOverlay() {
  const [asking, close] = useLaunchProfileQuestion();
  const view = useProfilesStore((state) => state.view);
  const switchTo = useProfilesStore((state) => state.switchTo);
  const switching = useProfilesStore((state) => state.switchingTo !== null);
  const showToast = useUiStore((state) => state.showToast);

  if (!asking || !view || switching) return null;

  const choose = (profile: Profile) => {
    if (profile.id === view.activeId) {
      close();
      return;
    }
    switchTo(profile).catch((reason: unknown) =>
      showToast({ message: profileErrorMessage(reason, "profiles_switch_failed"), variant: "error" }),
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="whos-watching-title"
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-10 bg-background p-6"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <h1 id="whos-watching-title" className="text-3xl font-bold tracking-tight text-chrome-neutral-100">
        {getString("profiles_whos_watching_title")}
      </h1>
      <div className="flex flex-wrap items-start justify-center gap-6">
        {view.profiles.map((profile) => {
          const name = profileDisplayName(profile);
          return (
            <button
              key={profile.id}
              type="button"
              autoFocus={profile.id === view.activeId}
              onClick={() => choose(profile)}
              className="flex w-32 flex-col items-center gap-3 rounded-2xl p-3 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ProfileAvatar
                name={name}
                colorKey={profile.colorKey}
                kind={profile.avatar.kind}
                emoji={profile.avatar.emoji}
                photoSrc={view.photos[profile.id]}
                size="xl"
              />
              <span className="line-clamp-2 text-sm font-medium text-chrome-neutral-100">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
