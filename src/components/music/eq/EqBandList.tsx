import { Plus, Trash2 } from "lucide-react";

import { defaultQ, EQ_FILTER_TYPES, EqLimits, hasGain, type EqBand, type EqFilterType } from "../../../lib/audio/eq/models";
import { getString, type StringKey } from "../../../lib/i18n/index";
import { Select } from "../../ui/Select";
import { Slider } from "../../ui/Slider";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { EqNumberField } from "./EqNumberField";

const TYPE_LABELS: Record<EqFilterType, StringKey> = {
  PEAK: "eq_type_peak",
  LOW_SHELF: "eq_type_low_shelf",
  HIGH_SHELF: "eq_type_high_shelf",
  LOW_PASS: "eq_type_low_pass",
  HIGH_PASS: "eq_type_high_pass",
};

// Q spans two decades, so its slider runs on a log scale: the middle is Q 1.4, not Q 10.
const Q_STEPS = 1_000;
const qToSlider = (q: number) =>
  Math.round((Math.log(q / EqLimits.MIN_Q) / Math.log(EqLimits.MAX_Q / EqLimits.MIN_Q)) * Q_STEPS);
const sliderToQ = (v: number) =>
  Math.round(EqLimits.MIN_Q * Math.pow(EqLimits.MAX_Q / EqLimits.MIN_Q, v / Q_STEPS) * 100) / 100;

export interface EqBandListProps {
  bands: readonly EqBand[];
  selected: number | null;
  canAdd: boolean;
  onSelect: (index: number) => void;
  onChange: (index: number, band: EqBand) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

export function EqBandList({ bands, selected, canAdd, onSelect, onChange, onRemove, onAdd }: EqBandListProps) {
  const typeOptions = EQ_FILTER_TYPES.map((type) => ({ value: type, label: getString(TYPE_LABELS[type]) }));

  return (
    <div className="flex flex-col gap-2">
      {bands.length === 0 ? (
        <p className="rounded-lg border border-dashed border-chrome-neutral-800 px-3 py-4 text-center text-sm text-chrome-neutral-500">
          {getString("eq_no_bands")}
        </p>
      ) : (
        <ul className="divide-y divide-chrome-neutral-800 rounded-lg border border-chrome-neutral-800">
          {bands.map((band, index) => (
            <li
              key={index}
              onFocusCapture={() => onSelect(index)}
              onPointerDown={() => onSelect(index)}
              className={`flex flex-wrap items-center gap-2 px-3 py-2 transition-colors duration-200 ease-out ${
                index === selected ? "bg-surface-container-high" : "hover:bg-surface-container-low"
              }`}
            >
              <span className="w-5 font-mono text-xs text-chrome-neutral-500">{index + 1}</span>
              <Select
                value={band.type}
                options={typeOptions}
                className="w-36"
                onChange={(value) => {
                  const type = value as EqFilterType;
                  onChange(index, { ...band, type, q: defaultQ(type), gain: hasGain(type) ? band.gain : 0 });
                }}
              />
              <EqNumberField
                value={band.frequency}
                decimals={0}
                unit={getString("eq_unit_hz")}
                ariaLabel={getString("eq_frequency")}
                onCommit={(frequency) => onChange(index, { ...band, frequency })}
              />
              <EqNumberField
                value={band.gain}
                decimals={1}
                unit={getString("eq_unit_db")}
                disabled={!hasGain(band.type)}
                ariaLabel={getString("eq_gain")}
                onCommit={(gain) => onChange(index, { ...band, gain })}
              />
              <div className="flex min-w-[10rem] flex-1 items-center gap-2">
                <span className="text-xs text-chrome-neutral-500">{getString("eq_q")}</span>
                <Slider
                  min={0}
                  max={Q_STEPS}
                  value={qToSlider(band.q)}
                  onChange={(v) => onChange(index, { ...band, q: sliderToQ(v) })}
                  aria-label={getString("eq_q")}
                  className="flex-1"
                />
                <EqNumberField
                  value={band.q}
                  decimals={2}
                  ariaLabel={getString("eq_q")}
                  onCommit={(q) => onChange(index, { ...band, q })}
                />
              </div>
              <ToggleSwitch checked={band.enabled} onChange={(enabled) => onChange(index, { ...band, enabled })} />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={getString("eq_remove_band")}
                className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        className="inline-flex items-center gap-1.5 self-start rounded-full bg-surface-container-high px-3 py-1.5 text-sm text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
        {getString("eq_add_band")}
      </button>
    </div>
  );
}
