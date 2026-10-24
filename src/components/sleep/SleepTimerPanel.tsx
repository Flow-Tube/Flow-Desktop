import { useState } from "react";
import { Check, Music2 } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { SLEEP_TIMER_PRESETS, parseCustomMinutes } from "../../lib/sleepTimer";
import { useSleepTimerStatus } from "../../lib/useSleepTimerStatus";
import { prefersQuitOnExpiry, setPrefersQuitOnExpiry, useSleepTimerStore } from "../../store/useSleepTimerStore";
import { ToggleSwitch } from "../ui/ToggleSwitch";

/** The video player's settings menu, or the music player's menu. */
export type SleepTimerTone = "video" | "music";

const ROW: Record<SleepTimerTone, string> = {
  video:
    "flex h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm font-medium text-chrome-zinc-100 hover:bg-chrome-white/10",
  music:
    "flex h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm font-medium text-chrome-neutral-100 hover:bg-surface-container-highest",
};

const MUTED: Record<SleepTimerTone, string> = {
  video: "text-chrome-zinc-300",
  music: "text-chrome-neutral-400",
};

interface SleepTimerPanelProps {
  tone: SleepTimerTone;
  /** Called once a choice is made, so the menu holding the panel can close. */
  onDone: () => void;
}

/** Presets, a custom time, End of song and Quit Flow, for the shared sleep timer. */
export function SleepTimerPanel({ tone, onDone }: SleepTimerPanelProps) {
  const status = useSleepTimerStatus();
  const activeQuit = useSleepTimerStore((s) => s.quitOnExpiry);
  const start = useSleepTimerStore((s) => s.start);
  const startEndOfSong = useSleepTimerStore((s) => s.startEndOfSong);
  const cancel = useSleepTimerStore((s) => s.cancel);
  const setQuitOnExpiry = useSleepTimerStore((s) => s.setQuitOnExpiry);
  const [quit, setQuit] = useState(() => (status.mode === "off" ? prefersQuitOnExpiry() : activeQuit));
  const [custom, setCustom] = useState("");
  const [customInvalid, setCustomInvalid] = useState(false);

  const choose = (action: () => void) => {
    action();
    onDone();
  };

  const startCustom = () => {
    const minutes = parseCustomMinutes(custom);
    if (minutes === null) {
      setCustomInvalid(true);
      return;
    }
    choose(() => start(minutes, quit));
  };

  const toggleQuit = (next: boolean) => {
    setQuit(next);
    void setPrefersQuitOnExpiry(next);
    setQuitOnExpiry(next);
  };

  return (
    <div className="space-y-1">
      {status.detail && <p className={`px-3 pb-1 text-xs ${MUTED[tone]}`}>{status.detail}</p>}

      {SLEEP_TIMER_PRESETS.map((minutes) => (
        <button key={minutes} type="button" className={ROW[tone]} onClick={() => choose(() => start(minutes, quit))}>
          <span>{getString("sleep_timer_minutes", minutes)}</span>
        </button>
      ))}

      <button type="button" className={ROW[tone]} onClick={() => choose(() => startEndOfSong(quit))}>
        <span className="flex items-center gap-2">
          <Music2 size={16} className={MUTED[tone]} />
          {getString("sleep_timer_end_of_song")}
        </span>
        {status.mode === "endOfSong" && <Check size={17} />}
      </button>

      <form
        className="flex items-center gap-2 px-3 py-1"
        onSubmit={(event) => {
          event.preventDefault();
          startCustom();
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            setCustomInvalid(false);
          }}
          placeholder={getString("sleep_timer_custom")}
          aria-label={getString("sleep_timer_custom")}
          aria-invalid={customInvalid}
          className="h-9 min-w-0 flex-1 rounded-md border border-chrome-neutral-700 bg-transparent px-2 text-sm text-chrome-neutral-100 outline-none placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-500"
        />
        <button
          type="submit"
          className="h-9 shrink-0 rounded-full bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-on-primary)]"
        >
          {getString("sleep_timer_start")}
        </button>
      </form>
      {customInvalid && <p className="px-3 text-xs text-chrome-red-400">{getString("sleep_timer_custom_invalid")}</p>}

      <div className={`${ROW[tone]} cursor-default hover:bg-transparent`}>
        <span>{getString("sleep_timer_quit_on_end")}</span>
        <ToggleSwitch checked={quit} onChange={toggleQuit} />
      </div>

      {status.mode !== "off" && (
        <button type="button" className={ROW[tone]} onClick={() => choose(cancel)}>
          <span>{getString("sleep_timer_turn_off")}</span>
        </button>
      )}
    </div>
  );
}
