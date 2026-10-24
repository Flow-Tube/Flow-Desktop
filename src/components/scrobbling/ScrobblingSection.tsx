import { useState } from "react";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingItem } from "../settings/SettingItem";
import { Button } from "../ui/Button";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { ScrobbleSignInDialog } from "./ScrobbleSignInDialog";
import { ScrobbleOwnKeyDialog } from "./ScrobbleOwnKeyDialog";
import { confirmAction } from "../../lib/dialogs";
import { getString, type StringKey } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";
import { useScrobbleSettings } from "../../lib/useScrobbleSettings";
import { SCROBBLE_SERVICES, type ScrobbleService, type ScrobbleServiceStatus } from "../../lib/api/scrobble";
import { useUiStore } from "../../store/useUiStore";

const SERVICE_NAME: Record<ScrobbleService, StringKey> = {
  LASTFM: "scrobbling_lastfm",
  LIBREFM: "scrobbling_librefm",
  LISTENBRAINZ: "scrobbling_listenbrainz",
};

function accountLabel(status: ScrobbleServiceStatus | undefined, ready: boolean): string {
  if (status?.signedIn) {
    return status.userName ? getString("scrobbling_signed_in_as", status.userName) : getString("scrobbling_signed_in");
  }
  return ready ? getString("scrobbling_not_signed_in") : getString("scrobbling_needs_key");
}

export function ScrobblingSection() {
  const { status, loadFailed, signIn, signOut, saveOwnKey, sendNow } = useScrobbleSettings();
  const showToast = useUiStore((state) => state.showToast);
  const [nowPlaying, setNowPlaying] = useBoolPref(SETTINGS.SCROBBLE_NOW_PLAYING);
  const [loveLikes, setLoveLikes] = useBoolPref(SETTINGS.SCROBBLE_LOVE_LIKES);
  const [deepFlow, setDeepFlow] = useBoolPref(SETTINGS.DEEP_FLOW_SCROBBLE);
  const [signingIn, setSigningIn] = useState<ScrobbleService | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [sending, setSending] = useState(false);

  const keychainBroken = !!status?.keychainError;
  const waiting = status?.services.reduce((sum, service) => sum + service.waiting, 0) ?? 0;

  const confirmSignOut = async (service: ScrobbleService) => {
    const name = getString(SERVICE_NAME[service]);
    if (!await confirmAction(getString("scrobbling_sign_out_confirm", name), name)) return;
    if (!await signOut(service)) showToast({ message: getString("scrobbling_sign_out_failed"), variant: "error" });
  };

  const toggleOwnKey = async (enabled: boolean) => {
    if (!await saveOwnKey(enabled)) showToast({ message: getString("scrobbling_own_key_failed"), variant: "error" });
  };

  const sendWaiting = async () => {
    setSending(true);
    const done = await sendNow();
    setSending(false);
    showToast(done
      ? { message: getString("scrobbling_send_now_done"), variant: "success" }
      : { message: getString("scrobbling_send_now_waiting"), variant: "info" });
  };

  const description = loadFailed
    ? getString("scrobbling_status_failed")
    : keychainBroken
      ? getString("scrobbling_keychain_unavailable")
      : getString("scrobbling_summary");

  return (
    <div className="space-y-4">
      <SettingsGroup title={getString("scrobbling_title")}>
        <p className="px-5 py-3 text-xs text-chrome-neutral-400">{description}</p>
        {SCROBBLE_SERVICES.map((service) => {
          const serviceStatus = status?.services.find((item) => item.service === service);
          const ready = service !== "LASTFM" || !!status?.lastFmReady;
          const signedIn = !!serviceStatus?.signedIn;
          return (
            <div key={service} className="flex flex-col divide-y divide-chrome-neutral-800/50">
              <SettingItem title={getString(SERVICE_NAME[service])} description={status ? accountLabel(serviceStatus, ready) : undefined}>
                {signedIn ? (
                  <Button variant="secondary" size="sm" onClick={() => void confirmSignOut(service)}>{getString("scrobbling_sign_out")}</Button>
                ) : (
                  <Button size="sm" disabled={!status || !ready || keychainBroken} onClick={() => setSigningIn(service)}>{getString("scrobbling_sign_in")}</Button>
                )}
              </SettingItem>
              {service === "LASTFM" && (
                <SettingItem title={getString("scrobbling_own_key")} description={getString("scrobbling_own_key_summary")} disabled={!status || keychainBroken}>
                  <ToggleSwitch checked={!!status?.ownKeyEnabled} onChange={(enabled) => void toggleOwnKey(enabled)} disabled={!status || keychainBroken} />
                </SettingItem>
              )}
              {service === "LASTFM" && status?.ownKeyEnabled && (
                <SettingItem
                  title={getString("scrobbling_own_key_values")}
                  description={status.ownKeyHint ? `${status.ownKeyHint}…` : getString("scrobbling_own_key_missing")}
                >
                  <Button variant="secondary" size="sm" onClick={() => setEditingKey(true)}>{getString("scrobbling_own_key_edit")}</Button>
                </SettingItem>
              )}
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={getString("scrobbling_options")}>
        <SettingItem title={getString("scrobbling_now_playing")} description={getString("scrobbling_now_playing_summary")}>
          <ToggleSwitch checked={nowPlaying} onChange={setNowPlaying} />
        </SettingItem>
        <SettingItem title={getString("scrobbling_send_likes")} description={getString("scrobbling_send_likes_summary")}>
          <ToggleSwitch checked={loveLikes} onChange={setLoveLikes} />
        </SettingItem>
        <SettingItem title={getString("scrobbling_deep_flow")} description={getString("scrobbling_deep_flow_summary")}>
          <ToggleSwitch checked={deepFlow} onChange={setDeepFlow} />
        </SettingItem>
        {waiting > 0 && (
          <SettingItem title={getString("scrobbling_send_now")} description={getString("scrobbling_waiting", waiting)}>
            <Button variant="secondary" size="sm" disabled={sending} onClick={() => void sendWaiting()}>{getString("scrobbling_send_now")}</Button>
          </SettingItem>
        )}
      </SettingsGroup>

      {signingIn && (
        <ScrobbleSignInDialog
          serviceName={getString(SERVICE_NAME[signingIn])}
          usesToken={signingIn === "LISTENBRAINZ"}
          onSubmit={(userName, secret) => signIn(signingIn, userName, secret)}
          onClose={() => setSigningIn(null)}
        />
      )}
      {editingKey && (
        <ScrobbleOwnKeyDialog
          onSave={(apiKey, secret) => saveOwnKey(true, { apiKey, secret })}
          onClose={() => setEditingKey(false)}
        />
      )}
    </div>
  );
}
