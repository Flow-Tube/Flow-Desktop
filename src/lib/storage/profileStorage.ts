// Web storage is one store per install, shared by every profile. Personal keys go through
// here so each profile sees only its own: Default keeps today's bare keys, other profiles use
// a "p:<id>:" prefix. The backend injects the active profile before any script runs.

export type StorageScope = "profile" | "device";

interface ActiveProfileInfo {
  id: string;
  isDefault: boolean;
}

declare global {
  interface Window {
    __FLOW_PROFILE__?: ActiveProfileInfo;
  }
}

export function activeProfile(): ActiveProfileInfo {
  const injected = typeof window === "undefined" ? undefined : window.__FLOW_PROFILE__;
  return injected?.id ? injected : { id: "", isDefault: true };
}

export function profilePrefix(profileId: string): string {
  return `p:${profileId}:`;
}

export function storageKey(key: string, scope: StorageScope = "profile"): string {
  const profile = activeProfile();
  return scope === "device" || profile.isDefault ? key : profilePrefix(profile.id) + key;
}

// Same throwing behaviour as localStorage, so callers keep their own error handling.
export const profileStorage = {
  getItem(key: string, scope?: StorageScope): string | null {
    return window.localStorage.getItem(storageKey(key, scope));
  },
  setItem(key: string, value: string, scope?: StorageScope): void {
    window.localStorage.setItem(storageKey(key, scope), value);
  },
  removeItem(key: string, scope?: StorageScope): void {
    window.localStorage.removeItem(storageKey(key, scope));
  },
  /** This profile's keys, without the prefix. */
  keys(): string[] {
    const profile = activeProfile();
    const all = Object.keys(window.localStorage);
    if (!profile.isDefault) {
      const prefix = profilePrefix(profile.id);
      return all.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    }
    return all.filter((key) => !key.startsWith("p:"));
  },
};

// Session storage dies with the process, so a profile switch (a restart) clears it anyway.
export const sessionStore = {
  getItem(key: string): string | null {
    return window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    window.sessionStorage.setItem(key, value);
  },
};
