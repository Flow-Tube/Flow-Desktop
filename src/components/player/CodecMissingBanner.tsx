import { AlertTriangle } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { CODEC_INSTALL_STEPS, useLinuxCodecSource } from "../../lib/linuxCodecSource";

interface CodecMissingBannerProps {
  onDismiss: () => void;
}

/** Linux played sound with no picture and no other codec was left to try. */
export function CodecMissingBanner({ onDismiss }: CodecMissingBannerProps) {
  const source = useLinuxCodecSource(true);
  const steps = source ? CODEC_INSTALL_STEPS[source] : null;
  return (
    <div className="absolute inset-x-4 top-4 z-40 mx-auto max-w-md rounded-2xl border border-chrome-toast-border bg-chrome-toast/95 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-primary" size={18} />
        <div className="min-w-0 space-y-2">
          <div className="text-sm font-bold text-chrome-neutral-100">{getString("player_codec_missing_title")}</div>
          <p className="text-xs text-chrome-neutral-300">{getString("player_codec_missing_hint")}</p>
          {steps ? (
            <>
              <p className="text-xs text-chrome-neutral-400">{getString(steps.hint)}</p>
              {steps.commands.length > 0 ? (
                <code className="block select-text overflow-x-auto whitespace-pre rounded-md bg-chrome-black/60 px-2 py-1.5 font-mono text-[11px] text-chrome-neutral-200">
                  {steps.commands.join("\n")}
                </code>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-semibold text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-100"
          >
            {getString("player_codec_missing_dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
