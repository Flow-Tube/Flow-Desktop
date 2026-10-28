import { useProfilesStore } from "../../store/useProfilesStore";
import { ProfileSwitchPanel } from "./ProfileSwitchPanel";

/** Covers the window from the moment a switch starts until the process restarts. */
export function ProfileSwitchOverlay() {
  const target = useProfilesStore((state) => state.switchingTo);
  const photo = useProfilesStore((state) => (target ? state.view?.photos[target.id] : undefined));
  if (!target) return null;
  return (
    <div className="animate-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-background">
      <ProfileSwitchPanel profile={target} photoSrc={photo} />
    </div>
  );
}
