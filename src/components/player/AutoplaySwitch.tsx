import { Pause, Play } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";

/** Whether the next video starts by itself, as a small switch on the player bar. */
export function AutoplaySwitch() {
  const [autoplay, setAutoplay] = useBoolPref(SETTINGS.AUTOPLAY_ENABLED);
  const label = getString(autoplay ? "player_autoplay_on" : "player_autoplay_off");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={autoplay}
      aria-label={getString("player_menu_autoplay")}
      title={label}
      onClick={() => setAutoplay(!autoplay)}
      className="hidden h-7 items-center rounded-full px-1.5 hover:bg-chrome-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex"
    >
      <span className={`relative h-3 w-8 rounded-full transition-colors duration-200 ease-out ${autoplay ? "bg-chrome-white/60" : "bg-chrome-white/25"}`}>
        <span
          className={`absolute -top-1 left-0 grid h-5 w-5 place-items-center rounded-full bg-chrome-white text-chrome-black transition-transform duration-200 ease-out ${
            autoplay ? "translate-x-3" : "translate-x-0"
          }`}
        >
          {autoplay ? <Play size={11} fill="currentColor" /> : <Pause size={11} fill="currentColor" />}
        </span>
      </span>
    </button>
  );
}
