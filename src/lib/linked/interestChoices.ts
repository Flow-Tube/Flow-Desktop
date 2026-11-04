import type { LocalLinkedProfile } from "../api/linked";
import type { Profile, ProfilesView } from "../api/profiles";

/** The profiles whose interests the Flow Neuro page can show: the running one first, then the
 * others that sync with linked devices. */
export function interestChoices(view: ProfilesView, local: LocalLinkedProfile[]): Profile[] {
  const synced = new Set(local.filter((profile) => profile.link).map((profile) => profile.id));
  const running = view.profiles.filter((profile) => profile.id === view.activeId);
  const others = view.profiles.filter((profile) => profile.id !== view.activeId && synced.has(profile.id));
  return [...running, ...others];
}
