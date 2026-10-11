import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { getString } from "../../lib/i18n/index";

/// How long the QR waits before suggesting network and firewall checks.
const NOT_CONNECTING_AFTER_MS = 45_000;

/** Copies the full connection data, for a peer without a camera to paste. */
export function CopyConnectionData({ data }: { data: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      setState("copied");
    } catch {
      // WebKitGTK and some WebView2 setups refuse clipboard writes; show the text to copy by hand.
      setState("failed");
    }
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

/** Appears once the code has waited a while with nobody connecting. */
export function NotConnectingHint({ since }: { since: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(false);
    const id = setTimeout(() => setShow(true), NOT_CONNECTING_AFTER_MS);
    return () => clearTimeout(id);
  }, [since]);

  if (!show) return null;
  return <p className="mt-3 max-w-sm text-xs text-chrome-amber-400">{getString("sync_not_connecting_hint")}</p>;
}
