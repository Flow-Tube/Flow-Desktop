import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  Camera,
  Check,
  Loader2,
  MonitorSmartphone,
  QrCode,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { Button } from "../components/ui/Button";
import { ToggleSwitch } from "../components/ui/ToggleSwitch";
import { useSyncStore } from "../store/useSyncStore";
import { SYNC_COLLECTIONS, type ManifestInfo, type StatInfo } from "../lib/api/sync";
import { getString, type StringKey } from "../lib/i18n/index";

// --------------------------------------------------------------------------------------------
// Collection display strings (resolved from i18n — no hardcoded copy in the view)
// --------------------------------------------------------------------------------------------

const COLLECTION_STRINGS: Record<string, { title: StringKey; desc: StringKey }> = {
  watch_history: { title: "sync_collection_watch_history", desc: "sync_collection_watch_history_desc" },
  playlists: { title: "sync_collection_playlists", desc: "sync_collection_playlists_desc" },
  likes: { title: "sync_collection_likes", desc: "sync_collection_likes_desc" },
  settings: { title: "sync_collection_settings", desc: "sync_collection_settings_desc" },
  flow_neuro_brain: { title: "sync_collection_flow_neuro_brain", desc: "sync_collection_flow_neuro_brain_desc" },
  music_brain: { title: "sync_collection_music_brain", desc: "sync_collection_music_brain_desc" },
  subscribed_channels: { title: "sync_collection_subscribed_channels", desc: "sync_collection_subscribed_channels_desc" },
  subscriptions: { title: "sync_collection_subscriptions", desc: "sync_collection_subscriptions_desc" },
};

function collectionTitle(key: string): string {
  const s = COLLECTION_STRINGS[key];
  return s ? getString(s.title) : key.replace(/_/g, " ");
}
function collectionDesc(key: string): string {
  const s = COLLECTION_STRINGS[key];
  return s ? getString(s.desc) : "";
}

// Snappy, non-bouncy screen transition (Design.md §6: no long/bouncy entry animations).
const SCREEN_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

// --------------------------------------------------------------------------------------------
// Shared small pieces
// --------------------------------------------------------------------------------------------

function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

/** Sleek neutral icon chip used in the section headers (clinical, never colored). */
function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-chrome-neutral-200">
      {children}
    </div>
  );
}

/** The 6-digit verification code, rendered as massive spaced monospace digits. */
function VerificationCode({ sas, size = "lg" }: { sas: string; size?: "lg" | "md" }) {
  return (
    <div className="flex flex-col items-center">
      <span className="mb-3 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
        {getString("sync_verification_code")}
      </span>
      <span
        className={`font-mono font-bold text-chrome-neutral-100 tracking-[0.3em] ${
          size === "lg" ? "text-5xl" : "text-3xl"
        }`}
      >
        {sas}
      </span>
    </div>
  );
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

// --------------------------------------------------------------------------------------------
// Camera scanner
// --------------------------------------------------------------------------------------------

function CameraScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserQRCodeReader();
    (async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
          if (result && !cancelled) {
            controlsRef.current?.stop();
            onResult(result.getText());
          }
        });
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch {
        if (!cancelled) setError(getString("sync_camera_error"));
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [onResult]);

  return (
    <div className="mt-6 space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-chrome-neutral-800 bg-chrome-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-chrome-white/70" />
      </div>
      {error && <p className="text-sm text-chrome-red-400">{error}</p>}
      <button
        type="button"
        onClick={onClose}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-surface-container-high py-2.5 text-sm font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
      >
        <X className="h-4 w-4" /> {getString("sync_stop_camera")}
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------------------------
// PHASE 1 — Setup state (2-pane dashboard)
// --------------------------------------------------------------------------------------------

function SetupState() {
  const { device, startHost, hostReceive, join, busy } = useSyncStore();
  // togglesState — which collections to send (local UI state; all on by default).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(SYNC_COLLECTIONS.map((c) => c.key)));
  const [scanning, setScanning] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onConnect = () => {
    const text = paste.trim();
    if (/^\d{4,8}$/.test(text)) {
      setPasteError(getString("sync_paste_is_sas"));
      return;
    }
    if (!text.startsWith("{")) {
      setPasteError(getString("sync_paste_invalid"));
      return;
    }
    setPasteError(null);
    void join(text);
  };

  const onScanned = useCallback(
    (text: string) => {
      setScanning(false);
      void join(text);
    },
    [join],
  );

  const canConnect = !busy && paste.trim().length > 0;

  return (
    <div className="mx-auto mt-10 max-w-5xl">
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* LEFT — Send */}
      <div className="flex flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6">
        <div className="flex items-center gap-3">
          <IconChip>
            <Send className="h-5 w-5" />
          </IconChip>
          <div>
            <h2 className="text-base font-medium text-chrome-neutral-100">{getString("sync_send_title")}</h2>
            <p className="text-sm text-chrome-neutral-400">{getString("sync_send_subtitle")}</p>
          </div>
        </div>

        <span className="mt-6 block px-1 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
          {getString("sync_send_list_label")}
        </span>

        {/* Continuous MD3 list group — no per-row boxes */}
        <div className="mb-6 mt-3 flex flex-col divide-y divide-chrome-neutral-800/50 overflow-hidden rounded-xl border border-chrome-neutral-800/50">
          {SYNC_COLLECTIONS.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between p-4 transition-colors hover:bg-surface-container"
            >
              <div className="min-w-0 pr-4">
                <p className="font-medium text-chrome-neutral-100">{collectionTitle(c.key)}</p>
                <p className="text-sm text-chrome-neutral-400">{collectionDesc(c.key)}</p>
              </div>
              <ToggleSwitch checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
            </div>
          ))}
        </div>

        {/* Primary CTA — high-contrast inverse (no red) */}
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => void startHost([...selected])}
          className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-chrome-white py-3 font-bold text-chrome-black transition-transform hover:bg-chrome-neutral-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
          {getString("sync_generate_code")}
        </button>
      </div>

      {/* RIGHT — Receive */}
      <div className="flex flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6">
        <div className="flex items-center gap-3">
          <IconChip>
            <ArrowDownToLine className="h-5 w-5" />
          </IconChip>
          <div>
            <h2 className="text-base font-medium text-chrome-neutral-100">{getString("sync_receive_title")}</h2>
            <p className="text-sm text-chrome-neutral-400">{getString("sync_receive_subtitle")}</p>
          </div>
        </div>

        {scanning ? (
          <CameraScanner onResult={onScanned} onClose={() => setScanning(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-surface-container-high py-3 font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
          >
            <Camera className="h-5 w-5" /> {getString("sync_scan_camera")}
          </button>
        )}

        <div className="my-6 flex items-center gap-4 text-xs uppercase tracking-widest text-chrome-neutral-500">
          <hr className="flex-1 border-chrome-neutral-800" />
          {getString("sync_divider_or")}
          <hr className="flex-1 border-chrome-neutral-800" />
        </div>

        {/* MD3 Filled TextField */}
        <div className="rounded-t-lg border-b-2 border-chrome-neutral-600 bg-surface-container px-4 py-3 transition-colors focus-within:border-primary">
          <input
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              if (pasteError) setPasteError(null);
            }}
            placeholder={getString("sync_paste_placeholder")}
            className="w-full bg-transparent text-chrome-neutral-100 outline-none placeholder:text-chrome-neutral-500"
          />
        </div>
        {pasteError && <p className="mt-2 px-1 text-xs text-chrome-red-400">{pasteError}</p>}

        <button
          type="button"
          disabled={!canConnect}
          onClick={onConnect}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-bold text-on-primary transition-transform hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
          {getString("sync_connect")}
        </button>

        {/* Camera-less fallback: host as receiver */}
        <div className="mt-auto pt-6">
          <button
            type="button"
            disabled={busy}
            onClick={() => void hostReceive()}
            className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium text-chrome-neutral-300 transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            <QrCode className="h-4 w-4" /> {getString("sync_show_qr_button")}
          </button>
          <p className="mt-1 px-1 text-center text-xs text-chrome-neutral-500">{getString("sync_show_qr_hint")}</p>
        </div>
      </div>
    </div>

      {device && (
        <p className="mt-6 text-center text-xs text-chrome-neutral-500">
          {getString("sync_this_device")}: <span className="text-chrome-neutral-300">{device.deviceName}</span>
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------
// PHASE 2 — Active pairing state (QR view)
// --------------------------------------------------------------------------------------------

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
    <div className="mx-auto mt-12 flex max-w-xl flex-col items-center justify-center text-center">
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

// --------------------------------------------------------------------------------------------
// Consent screen
// --------------------------------------------------------------------------------------------

function ConsentScreen() {
  const { status, respondConsent } = useSyncStore();
  const isMerge = status.consentKind === "clientMerge";
  const peerName = status.peer?.deviceName ?? getString("sync_peer_fallback");
  const manifests: ManifestInfo[] = status.manifests ?? [];

  return (
    <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-6 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8">
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

// --------------------------------------------------------------------------------------------
// Transient screens
// --------------------------------------------------------------------------------------------

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-5 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
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

function CompletedScreen() {
  const { status, reset } = useSyncStore();
  const isClient = status.role === "client";
  return (
    <CenteredCard>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-chrome-green-500/15 text-chrome-green-400">
        <Check className="h-6 w-6" />
      </div>
      <h2 className="text-base font-medium text-chrome-neutral-100">{getString("sync_complete_title")}</h2>
      {isClient && status.stats ? (
        <div className="w-full text-left">
          <StatsTable stats={status.stats} />
        </div>
      ) : (
        <p className="text-sm text-chrome-neutral-400">{getString("sync_complete_sent")}</p>
      )}
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

// --------------------------------------------------------------------------------------------
// Page
// --------------------------------------------------------------------------------------------

export default function Sync() {
  const { status, error, init } = useSyncStore();

  useEffect(() => {
    void init();
  }, [init]);

  const { screenKey, body } = useMemo(() => {
    switch (status.phase) {
      case "hosting":
        return { screenKey: "pairing", body: <PairingState /> };
      case "connecting":
        return { screenKey: "connecting", body: <ProgressScreen label={getString("sync_connecting")} /> };
      case "awaitingConsent":
        return { screenKey: "consent", body: <ConsentScreen /> };
      case "transferring":
        return { screenKey: "transferring", body: <ProgressScreen label={getString("sync_syncing")} /> };
      case "completed":
        return { screenKey: "completed", body: <CompletedScreen /> };
      case "declined":
        return {
          screenKey: "declined",
          body: (
            <MessageScreen
              icon={
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-chrome-neutral-300">
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
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-chrome-red-950/30 text-chrome-red-400">
                  <X className="h-6 w-6" />
                </div>
              }
              title={getString("sync_failed_title")}
              message={status.message ?? error ?? getString("sync_failed_body")}
            />
          ),
        };
      default:
        return { screenKey: "setup", body: <SetupState /> };
    }
  }, [status, error]);

  return (
    <div className="w-full px-6 py-8">
      <header className="mx-auto mb-2 flex max-w-5xl items-center gap-3">
        <IconChip>
          <MonitorSmartphone className="h-5 w-5 text-primary" />
        </IconChip>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("sync_page_title")}</h1>
          <p className="max-w-2xl text-sm text-chrome-neutral-400">{getString("sync_page_subtitle")}</p>
        </div>
      </header>

      {error && status.phase === "idle" && (
        <div className="mx-auto mt-4 flex max-w-5xl items-center gap-2 rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-3 text-sm text-chrome-red-400">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div key={screenKey} {...SCREEN_MOTION}>
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
