import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { getString } from "../../lib/i18n/index";
import { useMusicWheelVolume } from "../../lib/useMusicWheelVolume";
import { MENU_ENTER_TRANSITION, MENU_EXIT_TRANSITION } from "../../lib/motion";
import { shouldPinPlayerChrome } from "../../lib/playerChrome";
import { useToastTimer } from "../../lib/useToastTimer";
import { Slider } from "../ui/Slider";

const IDLE_CLOSE_MS = 2800;

/** Closes the popover once it sits untouched. Remounted on each volume change to restart the count. */
function IdleClose({ paused, onExpire }: { paused: boolean; onExpire: () => void }) {
  useToastTimer(IDLE_CLOSE_MS, paused, onExpire);
  return null;
}

export function VolumePopover({ open, onClose }: { open: boolean; onClose?: () => void }) {
  return <AnimatePresence>{open && <VolumePanel key="vol-popover" onClose={onClose} />}</AnimatePresence>;
}

function VolumePanel({ onClose }: { onClose?: () => void }) {
  const volume = useMusicPlayerStore((s) => s.volume);
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);
  const toggleMute = useMusicPlayerStore((s) => s.toggleMute);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  const wheelRef = useMusicWheelVolume();

  const shown = isMuted ? 0 : volume;

  return (
    <motion.div
      ref={wheelRef}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: MENU_ENTER_TRANSITION }}
      exit={{ opacity: 0, scale: 0.98, transition: MENU_EXIT_TRANSITION }}
      style={{ transformOrigin: "bottom center" }}
      className="flex w-60 items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-3"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Focus a click left behind on the slider doesn't hold it open; keyboard focus does.
      onFocus={(event) => setKeyboardFocus(shouldPinPlayerChrome(event.currentTarget, event.target))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
      }}
    >
      {onClose && <IdleClose key={`${volume}:${isMuted}`} paused={hovered || keyboardFocus} onExpire={onClose} />}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={getString(isMuted ? "music_unmute" : "music_mute")}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {shown === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={shown}
        onChange={setVolume}
        aria-label={getString("music_volume")}
        className="flex-1"
      />
      <span className="w-8 shrink-0 text-end font-mono text-xs tabular-nums text-chrome-neutral-400">
        {Math.round(shown * 100)}
      </span>
    </motion.div>
  );
}
