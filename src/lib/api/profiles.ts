import { invokeBackend } from "./errors";

// Mirrors the registry records in src-tauri/src/profiles/registry.rs (Android's JSON shape).
export type ProfileColorKey = "blue" | "teal" | "green" | "amber" | "orange" | "red" | "pink" | "purple";
export type ProfileAvatarKind = "initial" | "emoji" | "photo";

export interface ProfileAvatar {
  kind: ProfileAvatarKind | string;
  emoji: string;
  photoVersion: number;
}

export interface Profile {
  id: string;
  name: string;
  colorKey: ProfileColorKey | "" | string;
  avatar: ProfileAvatar;
  createdAt: number;
  splashTone: string;
}

export interface ProfilesView {
  profiles: Profile[];
  defaultId: string;
  activeId: string;
  maxProfiles: number;
}

export interface CopyParts {
  /** Profile setting keys to copy into the new profile. */
  settings: string[];
  subscriptions: boolean;
  recommendations: boolean;
}

export interface NewProfile {
  name: string;
  colorKey: string;
  avatar: ProfileAvatar;
  copy: CopyParts;
}

export const PROFILE_COLOR_KEYS: readonly ProfileColorKey[] = [
  "blue", "teal", "green", "amber", "orange", "red", "pink", "purple",
];

/** Counted in UTF-16 units, as on Android. */
export const PROFILE_NAME_MAX_LENGTH = 24;

export function listProfiles(): Promise<ProfilesView> {
  return invokeBackend<ProfilesView>("profiles_list");
}

export function createProfile(request: NewProfile): Promise<Profile> {
  return invokeBackend<Profile>("profiles_create", { request });
}

export function renameProfile(id: string, name: string): Promise<Profile> {
  return invokeBackend<Profile>("profiles_rename", { id, name });
}

export function setProfileLook(id: string, colorKey: string, avatar: ProfileAvatar): Promise<Profile> {
  return invokeBackend<Profile>("profiles_set_look", { id, colorKey, avatar });
}

export function deleteProfile(id: string): Promise<void> {
  return invokeBackend<void>("profiles_delete", { id });
}
