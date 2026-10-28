import { create } from "zustand";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  renameProfile,
  setProfileLook,
  type CopyParts,
  type NewProfile,
  type Profile,
  type ProfileAvatar,
  type ProfilesView,
} from "../lib/api/profiles";
import { normalizeBackendError } from "../lib/api/errors";
import { SETTING_DEFINITIONS } from "../lib/settings/schema";
import { copyKeysToProfile, removeProfileKeys, setProfileKey } from "../lib/storage/profileStorage";
import { switchProfile, type PrepareSwitchPayload } from "../lib/profiles/switchProfile";
import { BOOT_THEME_KEY, defaultBootTheme } from "../lib/profiles/bootTheme";

/** Web-storage preferences that travel with "Copy settings". */
const COPIED_UI_KEYS = [
  "flow_subtitle_style",
  "flow_theater_mode",
  "flow_sidebar_expanded",
  "flow_sidebar_subs_collapsed",
  BOOT_THEME_KEY,
];

export interface CopyChoice {
  settings: boolean;
  subscriptions: boolean;
  recommendations: boolean;
}

export function copyParts(choice: CopyChoice): CopyParts {
  return {
    // The backend drops in-progress state (Deep Flow, open tabs, SponsorBlock id) from this list.
    settings: choice.settings
      ? SETTING_DEFINITIONS.filter((definition) => definition.scope === "profile").map((definition) => definition.key)
      : [],
    subscriptions: choice.subscriptions,
    recommendations: choice.recommendations,
  };
}

interface ProfilesState {
  view: ProfilesView | null;
  loading: boolean;
  /** Backend error kind of the last failed load. */
  loadError: string | null;
  load: () => Promise<void>;
  create: (draft: Omit<NewProfile, "copy">, choice: CopyChoice) => Promise<Profile>;
  rename: (id: string, name: string) => Promise<void>;
  setLook: (id: string, colorKey: string, avatar: ProfileAvatar) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** The profile a switch is heading to, while this window waits for the restart. */
  switchingTo: Profile | null;
  switchTo: (profile: Profile) => Promise<void>;
}

function replaceProfile(view: ProfilesView | null, profile: Profile): ProfilesView | null {
  if (!view) return view;
  return { ...view, profiles: view.profiles.map((item) => (item.id === profile.id ? profile : item)) };
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  view: null,
  loading: false,
  loadError: null,

  load: async () => {
    set({ loading: true, loadError: null });
    try {
      set({ view: await listProfiles(), loading: false });
    } catch (error) {
      set({ loading: false, loadError: normalizeBackendError(error).kind });
    }
  },

  create: async (draft, choice) => {
    const profile = await createProfile({ ...draft, copy: copyParts(choice) });
    if (choice.settings) copyKeysToProfile(profile.id, COPIED_UI_KEYS);
    else setProfileKey(profile.id, BOOT_THEME_KEY, defaultBootTheme());
    await get().load();
    return profile;
  },

  // Optimistic, rolled back if the registry write fails.
  rename: async (id, name) => {
    const before = get().view;
    const current = before?.profiles.find((profile) => profile.id === id);
    if (current) set({ view: replaceProfile(before, { ...current, name: name.trim() }) });
    try {
      set({ view: replaceProfile(get().view, await renameProfile(id, name)) });
    } catch (error) {
      set({ view: before });
      throw error;
    }
  },

  setLook: async (id, colorKey, avatar) => {
    set({ view: replaceProfile(get().view, await setProfileLook(id, colorKey, avatar)) });
  },

  remove: async (id) => {
    await deleteProfile(id);
    removeProfileKeys(id);
    await get().load();
  },

  switchingTo: null,
  switchTo: async (profile) => {
    set({ switchingTo: profile });
    try {
      await switchProfile(profile);
    } catch (error) {
      set({ switchingTo: null });
      throw error;
    }
  },
}));

/** Another window started a switch: show it here too. */
export function markSwitching(payload: PrepareSwitchPayload): void {
  useProfilesStore.setState({ switchingTo: payload.target });
}
