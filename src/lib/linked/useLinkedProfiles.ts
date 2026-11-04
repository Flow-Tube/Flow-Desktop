import { useCallback, useEffect, useState } from "react";

import {
  chooseProfile,
  deleteSyncedProfile,
  getLinkedProfiles,
  onSynced,
  stopProfile,
  syncAddedProfile,
  syncProfile,
  type LinkedProfiles,
} from "../api/linked";
import { normalizeBackendError } from "../api/errors";
import { isTauriEnv } from "../api/env";
import { PROFILE_COLOR_KEYS, type ProfileColorKey } from "../api/profiles";
import { syncErrorMessage } from "../syncErrors";
import { useProfilesStore } from "../../store/useProfilesStore";

function describe(error: unknown): string {
  const { kind, message } = normalizeBackendError(error);
  return syncErrorMessage(kind, message);
}

/** The first color no profile here uses yet, for a profile added from another device. */
export function unusedColor(used: string[]): ProfileColorKey {
  return PROFILE_COLOR_KEYS.find((key) => !used.includes(key)) ?? "blue";
}

/** Which profiles here sync, the ones other devices sync, and the actions that change that. */
export function useLinkedProfiles() {
  const [profiles, setProfiles] = useState<LinkedProfiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfiles(await getLinkedProfiles());
    } catch (reason) {
      setError(describe(reason));
    }
  }, []);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void load();
    void isTauriEnv().then(async (tauri) => {
      if (!tauri) return;
      const unlisten = await onSynced(() => void load());
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await load();
      } catch (reason) {
        setError(describe(reason));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /** A new local profile named after a synced one, which it then joins. */
  const addHere = (name: string, link: string) =>
    run(async () => {
      const colorKey = unusedColor(useProfilesStore.getState().view?.profiles.map((p) => p.colorKey) ?? []);
      const profile = await useProfilesStore
        .getState()
        .create(
          { name, colorKey, avatar: { kind: "initial", emoji: "", photoVersion: 0 } },
          { settings: false, subscriptions: false, recommendations: false },
        );
      await syncAddedProfile(profile.id, link);
    });

  return {
    profiles,
    error,
    busy,
    start: (profile: string, link: string | null) => run(() => syncProfile(profile, link)),
    stop: (profile: string) => run(() => stopProfile(profile)),
    deleteEverywhere: (link: string) => run(() => deleteSyncedProfile(link)),
    choose: (link: string | null) => run(() => chooseProfile(link)),
    addHere,
  };
}
