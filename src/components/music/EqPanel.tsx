import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import {
  EQ_BANDS,
  EQ_MAX_GAIN_DB,
  EQ_PRESETS,
  type EqPresetName,
} from "../../lib/audio/eqBands";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Chip } from "../ui/Chip";
import { getString } from "../../lib/i18n/index";
import { Slider } from "../ui/Slider";

const PRESETS: EqPresetName[] = ["flat", "bass", "vocal", "treble", "electronic", "acoustic"];

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function formatGain(db: number | undefined): string {
  const v = Math.round(db ?? 0);
  return v > 0 ? `+${v}` : `${v}`;
}


export function EqPanel({
  open,
  onClose,
  placement = "top",
}: {
  open: boolean;
  onClose: () => void;
  placement?: "top" | "bottom";
}) {
  const eqEnabled = useMusicPlayerStore((s) => s.eqEnabled);
  const eqGains = useMusicPlayerStore((s) => s.eqGains);
  const setEqEnabled = useMusicPlayerStore((s) => s.setEqEnabled);
  const setEqBand = useMusicPlayerStore((s) => s.setEqBand);
  const applyEqPreset = useMusicPlayerStore((s) => s.applyEqPreset);

  const fromY = placement === "top" ? 10 : -10;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="eq-panel"
          initial={{ opacity: 0, y: fromY, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: fromY, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
          style={{ transformOrigin: placement === "top" ? "bottom right" : "top right" }}
          className="w-80 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-4"
        >
          {/* header */}
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              {getString("music_equalizer")}
            </span>
            <div className="flex items-center gap-2">
              <ToggleSwitch checked={eqEnabled} onChange={setEqEnabled} />
              <button
                type="button"
                onClick={onClose}
                aria-label={getString("music_collapse")}
                className="grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* presets */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Chip
                key={p}
                active={arraysEqual(eqGains, EQ_PRESETS[p])}
                onClick={() => applyEqPreset(p)}
                className="h-7 px-2.5 text-xs capitalize"
              >
                {p}
              </Chip>
            ))}
          </div>

          {/* sliders */}
          <div
            className={`flex items-end justify-between gap-1 transition-opacity duration-200 ${
              eqEnabled ? "" : "pointer-events-none opacity-40"
            }`}
          >
            {EQ_BANDS.map((band, i) => (
              <div key={band.frequency} className="flex flex-col items-center gap-1.5">
                <span className="font-mono text-[10px] tabular-nums text-chrome-neutral-500">
                  {formatGain(eqGains[i])}
                </span>
                <Slider
                  orientation="vertical"
                  min={-EQ_MAX_GAIN_DB}
                  max={EQ_MAX_GAIN_DB}
                  step={1}
                  value={eqGains[i] ?? 0}
                  onChange={(gain) => setEqBand(i, gain)}
                  aria-label={`${band.label} Hz`}
                />
                <span className="text-[10px] text-chrome-neutral-500">{band.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
