import { AnimatePresence, motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { getString } from "../../lib/i18n/index";
import { Slider } from "../ui/Slider";

export function VolumePopover({ open }: { open: boolean }) {
  const volume = useMusicPlayerStore((s) => s.volume);
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);
  const toggleMute = useMusicPlayerStore((s) => s.toggleMute);

  const shown = isMuted ? 0 : volume;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="vol-popover"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
          style={{ transformOrigin: "bottom center" }}
          className="flex w-60 items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-3"
        >
          <button
            type="button"
            onClick={toggleMute}
            aria-label={getString(isMuted ? "music_unmute" : "music_mute")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
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
          <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-chrome-neutral-400">
            {Math.round(shown * 100)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
