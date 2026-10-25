import { useState } from "react";
import { Moon } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";
import { useSleepTimerStore } from "../../store/useSleepTimerStore";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { SleepTimerPanel } from "../sleep/SleepTimerPanel";
import { HapticButton } from "./HapticButton";

interface MusicSleepTimerButtonProps {
  className: string;
  /** The look of the button while a timer is set, as the player's other toggles show "on". */
  activeClassName: string;
}

/** The music player's optional sleep timer button (a setting, off by default, as on Android). */
export function MusicSleepTimerButton({ className, activeClassName }: MusicSleepTimerButtonProps) {
  const [enabled] = useBoolPref(SETTINGS.MUSIC_SLEEP_TIMER_BUTTON, false);
  const active = useSleepTimerStore((s) => s.mode !== "off");
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  if (!enabled) return null;

  return (
    <>
      <HapticButton
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 6, right: rect.right });
        }}
        aria-label={getString("sleep_timer")}
        aria-pressed={active}
        className={active ? activeClassName : className}
      >
        <Moon className="h-5 w-5" />
      </HapticButton>
      {anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          className="z-[70] w-72 rounded-xl border border-chrome-neutral-800 bg-surface-container-high p-2"
        >
          <SleepTimerPanel tone="music" onDone={() => setAnchor(null)} />
        </AnchoredPortalMenu>
      )}
    </>
  );
}
