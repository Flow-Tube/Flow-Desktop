import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";

import { EqLimits } from "../../lib/audio/eq/models";
import { withBassBoost } from "../../lib/audio/eq/stateOps";
import { pickEqPreset, restoreCustomEq, useEqualizer, useMusicEqAvailable } from "../../lib/audio/eq/useEqualizer";
import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";
import { useEqStore } from "../../store/useEqStore";
import { Chip } from "../ui/Chip";
import { Slider } from "../ui/Slider";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { EqResponseGraph } from "./eq/EqResponseGraph";
import { formatDb } from "./eq/eqFormat";

/** The quick equalizer panel: switch, curve, presets and bass boost, with Edit for the rest. */
export function EqPanel({
  open,
  onClose,
  placement = "top",
}: {
  open: boolean;
  onClose: () => void;
  placement?: "top" | "bottom";
}) {
  const eq = useEqualizer();
  const available = useMusicEqAvailable();
  const update = useEqStore((s) => s.update);
  const setEditorOpen = useEqStore((s) => s.setEditorOpen);
  const [normalization, setNormalization] = useBoolPref(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION);

  const fromY = placement === "top" ? 10 : -10;
  const selectedId = eq.active.presetId;

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
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              {getString("music_equalizer")}
            </span>
            <div className="flex items-center gap-2">
              <ToggleSwitch
                checked={eq.state.enabled}
                onChange={(enabled) => update((s) => ({ ...s, enabled }))}
              />
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

          {!available && (
            <p className="mb-3 rounded-lg border border-chrome-neutral-800 px-3 py-2 text-xs text-chrome-neutral-400">
              {getString("eq_unavailable")}
            </p>
          )}

          <div className={`flex flex-col gap-3 transition-opacity duration-200 ${eq.state.enabled ? "" : "opacity-40"}`}>
            <div className="rounded-lg border border-chrome-neutral-800 bg-surface-container-low">
              <EqResponseGraph bands={eq.drawnBands} height={64} rangeDb={15} ariaLabel={getString("eq_graph_label")} />
            </div>

            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto hide-scrollbar">
              {eq.hasCustom && (
                <Chip
                  active={selectedId === null}
                  onClick={() => restoreCustomEq(eq.state.mode)}
                  className="h-7 px-2.5 text-xs"
                >
                  {getString("eq_preset_custom")}
                </Chip>
              )}
              {eq.presets.map((preset) => (
                <Chip
                  key={preset.id}
                  active={preset.id === selectedId}
                  onClick={() => pickEqPreset(preset.id)}
                  className="h-7 px-2.5 text-xs"
                >
                  {preset.name}
                </Chip>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-chrome-neutral-200">{getString("eq_bass_boost")}</span>
              <Slider
                min={0}
                max={EqLimits.MAX_BASS_BOOST}
                step={0.5}
                value={eq.state.bassBoost}
                onChange={(db) => update((s) => withBassBoost(s, db))}
                aria-label={getString("eq_bass_boost")}
                className="flex-1"
              />
              <span className="w-10 text-right font-mono text-xs text-chrome-neutral-400">
                {formatDb(eq.state.bassBoost)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              setEditorOpen(true);
            }}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-surface-container-high px-3 py-2 text-sm text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {getString("eq_edit")}
          </button>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-chrome-neutral-800 pt-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-chrome-neutral-200">{getString("music_loudness_normalization")}</span>
              <span className="text-xs text-chrome-neutral-500">{getString("music_loudness_normalization_desc")}</span>
            </span>
            <ToggleSwitch checked={normalization} onChange={setNormalization} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
