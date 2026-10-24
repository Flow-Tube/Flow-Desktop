import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { GraphicEq } from "../../../lib/audio/eq/limits";
import { band, EqLimits, type EqBand, type EqMode } from "../../../lib/audio/eq/models";
import {
  addBand,
  removeBand,
  withActiveCurve,
  withBand,
  withBassBoost,
  withManualPreamp,
} from "../../../lib/audio/eq/stateOps";
import { useEqualizer, useMusicEqAvailable } from "../../../lib/audio/eq/useEqualizer";
import { getString } from "../../../lib/i18n/index";
import { useEqStore } from "../../../store/useEqStore";
import { Chip } from "../../ui/Chip";
import { Slider } from "../../ui/Slider";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { EqBandList } from "./EqBandList";
import { EqCompareButton } from "./EqCompareButton";
import { EqGraphicSliders } from "./EqGraphicSliders";
import { EqImportExport } from "./EqImportExport";
import { EqPresetBar } from "./EqPresetBar";
import { EqResponseGraph } from "./EqResponseGraph";
import { formatDb } from "./eqFormat";

const SECTION_LABEL = "text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500";

/** The full equalizer editor, opened from the quick panel's Edit button. Mounted once. */
export function EqualizerDialog() {
  const open = useEqStore((s) => s.editorOpen);
  const setOpen = useEqStore((s) => s.setEditorOpen);
  const setPreview = useEqStore((s) => s.setPreview);
  const setBypass = useEqStore((s) => s.setBypass);

  useEffect(() => {
    useEqStore.setState({ editorHosted: true });
    return () => useEqStore.setState({ editorHosted: false });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Nothing held or dragged outlives the editor.
      setPreview(null);
      setBypass(false);
    };
  }, [open, setOpen, setPreview, setBypass]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-chrome-black/70 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <EqualizerEditor onClose={() => setOpen(false)} />
    </div>,
    document.body,
  );
}

function EqualizerEditor({ onClose }: { onClose: () => void }) {
  const eq = useEqualizer();
  const available = useMusicEqAvailable();
  const update = useEqStore((s) => s.update);
  const preview = useEqStore((s) => s.preview);
  const setPreview = useEqStore((s) => s.setPreview);
  const [selected, setSelected] = useState<number | null>(null);

  const { state, active } = eq;
  const graphic = state.mode === "GRAPHIC";
  const editedBands = (preview ?? active.curve).bands;

  const dragBand = (index: number, next: EqBand) => {
    const base = preview ?? active.curve;
    setPreview({ ...base, bands: base.bands.map((b, i) => (i === index ? next : b)) });
  };
  const commitDrag = () => {
    const curve = useEqStore.getState().preview;
    if (curve) update((s) => withActiveCurve(s, curve));
  };
  const add = (next: EqBand) => {
    update((s) => addBand(s, next));
    setSelected(active.curve.bands.length);
  };
  const setMode = (mode: EqMode) => {
    setSelected(null);
    update((s) => ({ ...s, mode }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={getString("music_equalizer")}
      className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-5 overflow-y-auto rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-chrome-neutral-100">{getString("music_equalizer")}</h2>
        <div className="flex items-center gap-3">
          <ToggleSwitch checked={state.enabled} onChange={(enabled) => update((s) => ({ ...s, enabled }))} />
          <button
            type="button"
            onClick={onClose}
            aria-label={getString("close")}
            className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!available && (
        <div className="rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2">
          <p className="text-sm font-medium text-chrome-neutral-200">{getString("eq_unavailable")}</p>
          <p className="text-xs text-chrome-neutral-500">{getString("eq_unavailable_desc")}</p>
        </div>
      )}

      <div className={`flex flex-col gap-5 ${state.enabled ? "" : "opacity-50"}`}>
        <div className="flex items-center gap-1.5">
          <Chip active={graphic} onClick={() => setMode("GRAPHIC")} className="h-8 px-3 text-sm">
            {getString("eq_mode_graphic")}
          </Chip>
          <Chip active={!graphic} onClick={() => setMode("PARAMETRIC")} className="h-8 px-3 text-sm">
            {getString("eq_mode_parametric")}
          </Chip>
          <EqCompareButton className="ml-auto" />
        </div>

        <section className="flex flex-col gap-2">
          <span className={SECTION_LABEL}>{getString("eq_presets")}</span>
          <EqPresetBar />
        </section>

        <div className="rounded-xl border border-chrome-neutral-800 bg-surface-container-low px-2 py-2">
          <EqResponseGraph
            bands={eq.drawnBands}
            handles={editedBands.map((b) => ({ band: b, verticalOnly: graphic }))}
            selected={selected}
            rangeDb={graphic ? GraphicEq.MAX_GAIN + 3 : 18}
            onSelect={setSelected}
            onDrag={dragBand}
            onDragEnd={commitDrag}
            onAddAt={graphic ? undefined : (frequency, gain) => add(band(frequency, gain))}
            ariaLabel={getString("eq_graph_label")}
          />
        </div>

        {graphic ? (
          <EqGraphicSliders
            bands={active.curve.bands}
            onChange={(index, gain) => {
              const current = active.curve.bands[index];
              if (current) update((s) => withBand(s, index, { ...current, gain }));
            }}
          />
        ) : (
          <EqBandList
            bands={active.curve.bands}
            selected={selected}
            canAdd={active.curve.bands.length < EqLimits.MAX_BANDS}
            onSelect={setSelected}
            onChange={(index, next) => update((s) => withBand(s, index, next))}
            onRemove={(index) => {
              setSelected(null);
              update((s) => removeBand(s, index));
            }}
            onAdd={() => add(band(1_000, 0))}
          />
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border border-chrome-neutral-800 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-chrome-neutral-200">{getString("eq_auto_preamp")}</span>
                <span className="text-xs text-chrome-neutral-500">{getString("eq_auto_preamp_desc")}</span>
              </span>
              <ToggleSwitch
                checked={state.autoPreamp}
                onChange={(autoPreamp) => update((s) => ({ ...s, autoPreamp }))}
              />
            </div>
            {state.autoPreamp ? (
              <span className="font-mono text-sm text-chrome-neutral-100">
                {getString("eq_db_value", formatDb(eq.autoPreampDb))}
              </span>
            ) : (
              <div className="flex items-center gap-3">
                <Slider
                  min={EqLimits.MIN_PREAMP}
                  max={EqLimits.MAX_PREAMP}
                  step={0.5}
                  value={active.curve.preamp}
                  onChange={(db) => update((s) => withManualPreamp(s, db))}
                  aria-label={getString("eq_preamp")}
                  className="flex-1"
                />
                <span className="w-16 text-right font-mono text-sm text-chrome-neutral-100">
                  {getString("eq_db_value", formatDb(active.curve.preamp))}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-chrome-neutral-800 p-3">
            <span className="text-sm text-chrome-neutral-200">{getString("eq_bass_boost")}</span>
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={EqLimits.MAX_BASS_BOOST}
                step={0.5}
                value={state.bassBoost}
                onChange={(db) => update((s) => withBassBoost(s, db))}
                aria-label={getString("eq_bass_boost")}
                className="flex-1"
              />
              <span className="w-16 text-right font-mono text-sm text-chrome-neutral-100">
                {getString("eq_db_value", formatDb(state.bassBoost))}
              </span>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <span className={SECTION_LABEL}>{getString("eq_import_title")}</span>
          <EqImportExport />
        </section>
      </div>
    </div>
  );
}
