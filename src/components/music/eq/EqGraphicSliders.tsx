import { GraphicEq } from "../../../lib/audio/eq/limits";
import type { EqBand } from "../../../lib/audio/eq/models";
import { getString } from "../../../lib/i18n/index";
import { Slider } from "../../ui/Slider";
import { formatDb, formatFrequency } from "./eqFormat";

export interface EqGraphicSlidersProps {
  bands: readonly EqBand[];
  disabled?: boolean;
  onChange: (index: number, gain: number) => void;
}

/** Android's ten graphic bands, ±12 dB in half-dB steps. */
export function EqGraphicSliders({ bands, disabled, onChange }: EqGraphicSlidersProps) {
  return (
    <div className={`flex items-end justify-between gap-1 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
      {bands.map((band, i) => (
        <div key={band.frequency} className="flex flex-col items-center gap-1.5">
          <span className="font-mono text-[10px] tabular-nums text-chrome-neutral-400">{formatDb(band.gain)}</span>
          <Slider
            orientation="vertical"
            min={-GraphicEq.MAX_GAIN}
            max={GraphicEq.MAX_GAIN}
            step={GraphicEq.STEP}
            value={band.gain}
            onChange={(gain) => onChange(i, gain)}
            aria-label={getString("eq_band_label", formatFrequency(band.frequency))}
          />
          <span className="font-mono text-[10px] text-chrome-neutral-500">{formatFrequency(band.frequency)}</span>
        </div>
      ))}
    </div>
  );
}
