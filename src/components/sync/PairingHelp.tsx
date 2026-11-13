import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { copyText } from "../../lib/clipboard";
import { IS_LINUX_RUNTIME, IS_WINDOWS_RUNTIME } from "../../lib/platform";
import { firewallCommands, useSyncFirewallHelp } from "../../lib/syncFirewall";

/// How long the QR waits before suggesting network and firewall checks.
const NOT_CONNECTING_AFTER_MS = 45_000;

/** Copies the full connection data, for a peer without a camera to paste. */
export function CopyConnectionData({ data }: { data: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    // WebKitGTK and some WebView2 setups refuse clipboard writes; show the text to copy by hand.
    setState((await copyText(data)) ? "copied" : "failed");
  };

  return (
    <div className="mt-6 flex w-full max-w-sm flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
      >
        {state === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {state === "copied" ? getString("sync_copied") : getString("sync_copy_connection")}
      </button>
      <p className="text-xs text-chrome-neutral-500">{getString("sync_copy_hint")}</p>
      {state === "failed" && (
        <>
          <p className="text-xs text-chrome-red-400">{getString("sync_copy_failed")}</p>
          <textarea
            readOnly
            value={data}
            onFocus={(e) => e.currentTarget.select()}
            className="h-20 w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container px-3 py-2 font-mono text-xs text-chrome-neutral-300"
          />
        </>
      )}
    </div>
  );
}

/** A terminal command to copy, shown as text too since WebKitGTK may refuse the copy. */
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const label = copied ? getString("sync_copied") : getString("sync_copy_command");
  return (
    <div className="flex items-center gap-2 rounded-lg border border-chrome-neutral-800 bg-surface-container px-3 py-2">
      <code dir="ltr" className="min-w-0 flex-1 select-text break-all text-start font-mono text-xs text-chrome-neutral-200">
        {command}
      </code>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => void copyText(command).then(setCopied)}
        className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

interface NotConnectingHintProps {
  /** Restarts the wait when the code changes. */
  since: string;
  /** The port the other device dials; Linked devices reads its own. */
  port?: number;
  /** Linked devices: its own port, plus discovery on the network. */
  linked?: boolean;
  /** One-time transfer can start on the phone instead, which needs nothing let in here. */
  scanInstead?: boolean;
}

/** Appears once the code has waited a while with nobody connecting. */
export function NotConnectingHint({ since, port, linked = false, scanInstead = false }: NotConnectingHintProps) {
  const [show, setShow] = useState(false);
  const help = useSyncFirewallHelp();

  useEffect(() => {
    setShow(false);
    const id = setTimeout(() => setShow(true), NOT_CONNECTING_AFTER_MS);
    return () => clearTimeout(id);
  }, [since]);

  if (!show) return null;
  const listening = linked ? (help?.linkedPort ?? undefined) : port;
  const commands = IS_LINUX_RUNTIME && help && listening ? firewallCommands(help.firewalls, listening, linked) : [];
  let message: string;
  if (IS_WINDOWS_RUNTIME) message = getString("sync_not_connecting_hint");
  else if (commands.length > 0) message = getString("sync_not_connecting_hint_linux");
  else if (IS_LINUX_RUNTIME && listening) message = getString("sync_not_connecting_hint_linux_port", String(listening));
  else message = getString("sync_not_connecting_hint_other");

  return (
    <div className="mt-3 flex w-full max-w-sm flex-col gap-2">
      <p className="text-xs text-chrome-amber-400">{message}</p>
      {commands.map((command) => (
        <CommandLine key={command} command={command} />
      ))}
      {scanInstead && <p className="text-xs text-chrome-neutral-400">{getString("sync_not_connecting_scan_instead")}</p>}
    </div>
  );
}
