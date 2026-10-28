import type { Profile } from "../../lib/api/profiles";
import { getString } from "../../lib/i18n/index";
import { profileDisplayName } from "../../lib/profiles/display";
import { ProfileAvatar } from "../ui/ProfileAvatar";

/** "Switching to …": shown while the windows save their work, and by the restarted app's
 *  loading screen, so the hand-over reads as one step. */
export function ProfileSwitchPanel({ profile, photoSrc }: { profile: Profile; photoSrc?: string | null }) {
  const name = profileDisplayName(profile);
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 text-center">
      <ProfileAvatar
        name={name}
        colorKey={profile.colorKey}
        kind={profile.avatar.kind}
        emoji={profile.avatar.emoji}
        photoSrc={photoSrc}
        size="xl"
      />
      <p className="text-lg font-medium text-chrome-neutral-100">{getString("profiles_switching_to", name)}</p>
      <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden="true" />
    </div>
  );
}
