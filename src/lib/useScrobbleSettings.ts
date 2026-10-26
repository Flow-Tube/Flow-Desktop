import { useCallback, useEffect, useState } from "react";

import { normalizeBackendError } from "./api/errors";
import {
  flushScrobbles,
  getScrobbleStatus,
  retryScrobbleKeychain,
  scrobbleSignIn,
  scrobbleSignOut,
  setScrobbleOwnKey,
  type ScrobbleService,
  type ScrobbleStatus,
} from "./api/scrobble";
import { getString } from "./i18n/index";

/** A sign-in failure as the dialog shows it: the service's own words when it gave any. */
export function signInErrorMessage(error: unknown): string {
  const { kind, message } = normalizeBackendError(error);
  switch (kind) {
    case "scrobbleSignInRejected":
      return message.trim() || getString("scrobbling_sign_in_failed");
    case "scrobbleKeyMissing":
      return getString("scrobbling_needs_key");
    case "network":
    case "rateLimited":
      return getString("scrobbling_sign_in_offline");
    case "keychain":
      return getString("scrobbling_keychain_unavailable");
    default:
      return getString("scrobbling_sign_in_failed");
  }
}

export function useScrobbleSettings() {
  const [status, setStatus] = useState<ScrobbleStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getScrobbleStatus());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Resolves to null on success, or the message to show. */
  const signIn = useCallback(async (service: ScrobbleService, userName: string, secret: string) => {
    try {
      await scrobbleSignIn(service, userName, secret);
      await refresh();
      return null;
    } catch (error) {
      return signInErrorMessage(error);
    }
  }, [refresh]);

  const signOut = useCallback(async (service: ScrobbleService) => {
    try {
      await scrobbleSignOut(service);
      return true;
    } catch {
      return false;
    } finally {
      await refresh();
    }
  }, [refresh]);

  const saveOwnKey = useCallback(async (enabled: boolean, keys?: { apiKey: string; secret: string }) => {
    try {
      await setScrobbleOwnKey(enabled, keys);
      return true;
    } catch {
      return false;
    } finally {
      await refresh();
    }
  }, [refresh]);

  /** True once the keychain could be read. */
  const retryKeychain = useCallback(async () => {
    try {
      await retryScrobbleKeychain();
      return true;
    } catch {
      return false;
    } finally {
      await refresh();
    }
  }, [refresh]);

  /** True when everything was sent, false when some listens are still waiting. */
  const sendNow = useCallback(async () => {
    try {
      return await flushScrobbles();
    } catch {
      return false;
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { status, loadFailed, refresh, signIn, signOut, saveOwnKey, retryKeychain, sendNow };
}
