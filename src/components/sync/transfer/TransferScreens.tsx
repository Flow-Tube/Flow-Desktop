import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Info, Loader2, RotateCcw, ShieldCheck, UserRound, X } from "lucide-react";

import { CopyConnectionData, NotConnectingHint } from "../PairingHelp";
import { IconChip, Spinner, VerificationCode } from "../SyncParts";
import { Button } from "../../ui/Button";
import { useSyncStore } from "../../../store/useSyncStore";
import type { ManifestInfo, StatInfo, WithheldInfo, WithheldReason } from "../../../lib/api/sync";
import { getString, type StringKey } from "../../../lib/i18n/index";
import { syncErrorMessage } from "../../../lib/syncErrors";
import type { Profile } from "../../../lib/api/profiles";
import { profileDisplayName } from "../../../lib/profiles/display";
import { profileErrorMessage } from "../../../lib/profiles/profileErrors";
import { useProfilesStore } from "../../../store/useProfilesStore";

/** The screens of a one-time transfer (FLOW-SYNC/1) once it has started, from the code to the result. */

const COLLECTION_STRINGS: Record<string, { title: StringKey; desc: StringKey }> = {
  watch_history: { title: "sync_collection_watch_history", desc: "sync_collection_watch_history_desc" },
  playlists: { title: "sync_collection_playlists", desc: "sync_collection_playlists_desc" },
  likes: { title: "sync_collection_likes", desc: "sync_collection_likes_desc" },
  settings: { title: "sync_collection_settings", desc: "sync_collection_settings_desc" },
  flow_neuro_brain: { title: "sync_collection_flow_neuro_brain", desc: "sync_collection_flow_neuro_brain_desc" },
  music_brain: { title: "sync_collection_music_brain", desc: "sync_collection_music_brain_desc" },
  subscribed_channels: { title: "sync_collection_subscribed_channels", desc: "sync_collection_subscribed_channels_desc" },
  subscriptions: { title: "sync_collection_subscriptions", desc: "sync_collection_subscriptions_desc" },
  notes: { title: "sync_collection_notes", desc: "sync_collection_notes_desc" },
};

export function collectionTitle(key: string): string {
  const s = COLLECTION_STRINGS[key];
  return s ? getString(s.title) : key.replace(/_/g, " ");
}
export function collectionDesc(key: string): string {
  const s = COLLECTION_STRINGS[key];
  return s ? getString(s.desc) : "";
}

function StatsTable({ stats }: { stats: StatInfo[] }) {
  const meaningful = stats.filter((s) => s.added + s.updated + s.tombstoned > 0 || s.skipped > 0);
  if (meaningful.length === 0) {
    return <p className="text-sm text-chrome-neutral-400">{getString("sync_up_to_date")}</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-chrome-neutral-800/50 overflow-hidden rounded-xl border border-chrome-neutral-800/50">
      {meaningful.map((s) => (
        <div key={s.collection} className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-chrome-neutral-200">{collectionTitle(s.collection)}</span>
          <span className="font-mono text-xs text-chrome-neutral-400">
            {s.added > 0 && <span className="text-chrome-green-400">{getString("sync_stat_new", s.added)} </span>}
            {s.updated > 0 && <span className="text-chrome-blue-400">{getString("sync_stat_updated", s.updated)} </span>}
            {s.tombstoned > 0 && (
              <span className="text-chrome-amber-400">{getString("sync_stat_removed", s.tombstoned)} </span>
            )}
            {s.added + s.updated + s.tombstoned === 0 && <span>{getString("sync_stat_uptodate")}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function PairingState() {
  const { hostInfo, cancel } = useSyncStore();
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!hostInfo) return;
    const tick = () => setRemaining(Math.max(0, hostInfo.expiresAt - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hostInfo]);

  if (!hostInfo) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <Spinner className="h-6 w-6 text-chrome-neutral-400" />
        <p className="text-sm text-chrome-neutral-400">{getString("sync_preparing")}</p>
      </div>
    );
  }

  const expired = remaining <= 0;

  return (
    <div className="mx-auto mt-6 flex max-w-xl flex-col items-center justify-center text-center">
      <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
        {hostInfo.receive ? getString("sync_pair_receive_title") : getString("sync_pair_scan_title")}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-chrome-neutral-400">
        {hostInfo.receive ? getString("sync_pair_receive_subtitle") : getString("sync_pair_scan_subtitle")}
      </p>

      {/* Brilliant white squircle (no shadow per Design.md §1) */}
      <div className="mb-8 mt-8 rounded-3xl bg-chrome-white p-6">
        <QRCodeSVG value={hostInfo.qr} size={232} level="M" marginSize={1} />
      </div>

      <VerificationCode sas={hostInfo.sas} />
      <p className="mt-3 text-xs text-chrome-neutral-500">{getString("sync_verification_hint")}</p>

      {/* Status indicator with pulsing dot */}
      <div className="mt-6 flex items-center gap-3 rounded-full bg-surface-container-low px-4 py-2 text-sm text-chrome-neutral-400">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        {expired ? getString("sync_expired") : getString("sync_waiting_connect")}
      </div>
      {!expired && <p className="mt-2 font-mono text-xs text-chrome-neutral-500">{getString("sync_expires_in", remaining)}</p>}
      {!expired && <NotConnectingHint since={hostInfo.qr} port={hostInfo.port} scanInstead />}

      <CopyConnectionData data={hostInfo.qr} />

      <p className="mt-6 font-mono text-xs text-chrome-neutral-500">
        {getString("sync_host_address", `${hostInfo.ip}:${hostInfo.port}`)}
      </p>
      <p className="mt-1 max-w-xs text-xs text-chrome-neutral-600">{getString("sync_host_address_hint")}</p>

      <Button variant="secondary" onClick={() => void cancel()} className="mt-10 px-6">
        <X className="h-4 w-4" /> {getString("sync_cancel")}
      </Button>
    </div>
  );
}

function ConsentScreen() {
  const { status, respondConsent } = useSyncStore();
  const isMerge = status.consentKind === "clientMerge";
  const peerName = status.peer?.deviceName ?? getString("sync_peer_fallback");
  const manifests: ManifestInfo[] = status.manifests ?? [];

  return (
    <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-6 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8">
      <IconChip>
        <ShieldCheck className="h-5 w-5" />
      </IconChip>

      <div className="text-center">
        <h2 className="text-base font-medium text-chrome-neutral-100">
          {isMerge
            ? getString("sync_consent_merge_title", peerName)
            : getString("sync_consent_allow_title", peerName)}
        </h2>
        <p className="mt-1 text-sm text-chrome-neutral-400">
          {isMerge ? getString("sync_consent_merge_subtitle") : getString("sync_consent_allow_subtitle")}
        </p>
      </div>

      {status.sas && <VerificationCode sas={status.sas} size="md" />}

      {isMerge && manifests.length > 0 && (
        <div className="flex w-full flex-col divide-y divide-chrome-neutral-800/50 overflow-hidden rounded-xl border border-chrome-neutral-800/50">
          {manifests.map((m) => (
            <div key={m.collection} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-chrome-neutral-200">{collectionTitle(m.collection)}</span>
              <span className="font-mono text-xs text-chrome-neutral-400">
                {getString("sync_items_count", m.recordCount)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex w-full gap-3">
        <button
          type="button"
          onClick={() => void respondConsent(false)}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-chrome-red-900/50 bg-chrome-red-950/30 py-2.5 text-sm font-medium text-chrome-red-400 transition-colors hover:bg-chrome-red-950/50"
        >
          <X className="h-4 w-4" /> {getString("sync_deny")}
        </button>
        <button
          type="button"
          onClick={() => void respondConsent(true)}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-bold text-on-primary transition-transform hover:opacity-90 active:scale-95"
        >
          <Check className="h-4 w-4" /> {isMerge ? getString("sync_merge") : getString("sync_allow")}
        </button>
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-5 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
      {children}
    </div>
  );
}

function ProgressScreen({ label }: { label: string }) {
  return (
    <CenteredCard>
      <Spinner className="h-8 w-8 text-primary" />
      <p className="text-sm text-chrome-neutral-300">{label}</p>
    </CenteredCard>
  );
}

// Sender-side: keep the code visible while the peer confirms it (only the sender's status has sas).
function SendingVerifyScreen() {
  const { status } = useSyncStore();
  if (!status.sas) {
    return <ProgressScreen label={getString("sync_syncing")} />;
  }
  return (
    <div className="mx-auto mt-6 flex max-w-xl flex-col items-center justify-center text-center">
      <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
        {getString("sync_verify_title")}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-chrome-neutral-400">{getString("sync_verify_subtitle")}</p>

      <div className="my-10">
        <VerificationCode sas={status.sas} />
      </div>

      <div className="flex items-center gap-3 rounded-full bg-surface-container-low px-4 py-2 text-sm text-chrome-neutral-400">
        <Spinner className="h-3.5 w-3.5" />
        {getString("sync_waiting_accept")}
      </div>
    </div>
  );
}

const WITHHELD_STRINGS: Record<WithheldReason, StringKey> = {
  peerNewer: "sync_withheld_peer_newer",
  peerOlder: "sync_withheld_peer_older",
  keyLanguage: "sync_withheld_key_language",
};

function WithheldNotes({ withheld }: { withheld: WithheldInfo[] }) {
  return (
    <ul className="flex w-full flex-col gap-2 text-start">
      {withheld.map((item) => (
        <li
          key={item.collection}
          className="flex items-start gap-2 rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2.5 text-sm text-chrome-neutral-300"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-chrome-neutral-400" />
          <span>{getString(WITHHELD_STRINGS[item.reason], collectionTitle(item.collection))}</span>
        </li>
      ))}
    </ul>
  );
}

function CompletedScreen() {
  const { status, reset } = useSyncStore();
  return (
    <CenteredCard>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-chrome-green-500/15 text-chrome-green-400">
        <Check className="h-6 w-6" />
      </div>
      <h2 className="text-base font-medium text-chrome-neutral-100">{getString("sync_complete_title")}</h2>
      {status.direction === "received" && status.stats ? (
        <div className="w-full text-start">
          <StatsTable stats={status.stats} />
        </div>
      ) : (
        <p className="text-sm text-chrome-neutral-400">{getString("sync_complete_sent")}</p>
      )}
      {status.withheld && status.withheld.length > 0 && <WithheldNotes withheld={status.withheld} />}
      <button
        type="button"
        onClick={() => void reset()}
        className="rounded-full bg-chrome-white px-6 py-2.5 text-sm font-bold text-chrome-black transition-transform hover:bg-chrome-neutral-200 active:scale-95"
      >
        {getString("sync_done")}
      </button>
    </CenteredCard>
  );
}

function MessageScreen({ icon, title, message }: { icon: React.ReactNode; title: string; message?: string }) {
  const { reset } = useSyncStore();
  return (
    <CenteredCard>
      {icon}
      <h2 className="text-base font-medium text-chrome-neutral-100">{title}</h2>
      {message && <p className="text-sm text-chrome-neutral-400">{message}</p>}
      <Button variant="secondary" onClick={() => void reset()} className="px-6">
        <RotateCcw className="h-4 w-4" /> {getString("sync_start_over")}
      </Button>
    </CenteredCard>
  );
}

/** A one-time transfer (FLOW-SYNC/1) carries no profile and syncs Default only, so other profiles offer
 * the switch; Linked devices sync any profile. */
export function DefaultOnlyScreen({ defaultProfile }: { defaultProfile: Profile }) {
  const switchTo = useProfilesStore((state) => state.switchTo);
  const switching = useProfilesStore((state) => state.switchingTo !== null);
  const [error, setError] = useState<string | null>(null);
  const name = profileDisplayName(defaultProfile);
  const onSwitch = () => {
    setError(null);
    switchTo(defaultProfile).catch((reason: unknown) => setError(profileErrorMessage(reason, "profiles_switch_failed")));
  };
  return (
    <CenteredCard>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-chrome-neutral-300">
        <UserRound className="h-6 w-6" />
      </div>
      <h2 className="text-base font-medium text-chrome-neutral-100">{getString("sync_default_only_title", name)}</h2>
      <p className="text-sm text-chrome-neutral-400">{getString("sync_default_only_body")}</p>
      {error && <p className="text-sm text-chrome-red-400">{error}</p>}
      <Button variant="primary" onClick={onSwitch} disabled={switching} className="px-6">
        {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {getString("sync_default_only_action", name)}
      </Button>
    </CenteredCard>
  );
}

export type TransferScreenKey = "pairing" | "connecting" | "consent" | "transferring" | "completed" | "declined" | "error";

const iconCircle = (tone: string) => `flex h-12 w-12 items-center justify-center rounded-full ${tone}`;

/** The screen for a transfer under way, with a key per screen for the page's transition; null while idle. */
export function useTransferScreen(): { screenKey: TransferScreenKey; body: React.ReactNode } | null {
  const { status, error } = useSyncStore();
  switch (status.phase) {
    case "hosting":
      return { screenKey: "pairing", body: <PairingState /> };
    case "connecting":
      return { screenKey: "connecting", body: <ProgressScreen label={getString("sync_connecting")} /> };
    case "awaitingConsent":
      return { screenKey: "consent", body: <ConsentScreen /> };
    case "transferring":
      // One key for the whole phase: verify → syncing is a content swap, not a screen change.
      // Separate keys double-play the enter animation under StrictMode and flicker.
      return {
        screenKey: "transferring",
        body: status.sas ? <SendingVerifyScreen /> : <ProgressScreen label={getString("sync_syncing")} />,
      };
    case "completed":
      return { screenKey: "completed", body: <CompletedScreen /> };
    case "declined":
      return {
        screenKey: "declined",
        body: (
          <MessageScreen
            icon={
              <div className={iconCircle("bg-surface-container-high text-chrome-neutral-300")}>
                <X className="h-6 w-6" />
              </div>
            }
            title={getString("sync_declined_title")}
            message={getString("sync_declined_body")}
          />
        ),
      };
    case "error":
      return {
        screenKey: "error",
        body: (
          <MessageScreen
            icon={
              <div className={iconCircle("bg-chrome-red-950/30 text-chrome-red-400")}>
                <X className="h-6 w-6" />
              </div>
            }
            title={getString("sync_failed_title")}
            message={
              status.errorKind || status.message ? syncErrorMessage(status.errorKind, status.message) : (error ?? getString("sync_failed_body"))
            }
          />
        ),
      };
    default:
      return null;
  }
}
