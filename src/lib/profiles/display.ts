import type { Profile } from "../api/profiles";
import { getString } from "../i18n/index";

/** Any blank name shows as "Default", as on Android. */
export function profileDisplayName(profile: Pick<Profile, "name">): string {
  return profile.name.trim() || getString("profiles_default_name");
}
