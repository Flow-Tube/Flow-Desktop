import { Speaker } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { Button } from "../ui/Button";

/** Asks whether another device may play on or control this one (spec/live.md, Consent). */
export function ConsentDialog() {
  const request = usePlayOnStore((state) => state.asking[0]);
  const linked = usePlayOnStore((state) => state.linked);
  const answer = usePlayOnStore((state) => state.answer);
  if (!request) return null;
  const name = linked.find((device) => device.id === request.from)?.name || getString("play_on_another_device");
  const title = getString(request.message.type === "play" ? "play_on_consent_play" : "play_on_consent_control", name);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-chrome-black/70 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-on-consent-title"
        className="animate-fade-in w-full max-w-md rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
      >
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-container-high">
            <Speaker className="h-6 w-6 text-[var(--color-primary)]" />
          </span>
          <div className="min-w-0">
            <h2 id="play-on-consent-title" className="text-lg font-bold tracking-tight text-chrome-neutral-100">
              {title}
            </h2>
            <p className="mt-1 text-sm text-chrome-neutral-400">{getString("play_on_consent_body")}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="destructive" onClick={() => void answer("decline")}>
            {getString("play_on_decline")}
          </Button>
          <Button variant="tonal" onClick={() => void answer("once")}>
            {getString("play_on_allow_once")}
          </Button>
          <Button onClick={() => void answer("always")}>{getString("play_on_allow_always")}</Button>
        </div>
      </div>
    </div>
  );
}
