import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref, useNumberPref } from "../../lib/usePreference";
import { Chip } from "../ui/Chip";
import { Slider } from "../ui/Slider";
import { ToggleSwitch } from "../ui/ToggleSwitch";

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const formatSpeed = (rate: number) => getString("music_speed_value", Number(rate.toFixed(2)));

/** Music audio settings beside the equalizer: loudness normalization, speed and crossfade. */
export function MusicAudioOptions() {
  const [normalization, setNormalization] = useBoolPref(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION);
  const [speed, setSpeed] = useNumberPref(SETTINGS.MUSIC_PLAYBACK_SPEED);
  const [crossfade, setCrossfade] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_ENABLED);
  const [crossfadeSeconds, setCrossfadeSeconds] = useNumberPref(SETTINGS.MUSIC_CROSSFADE_SECONDS);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-chrome-neutral-200">{getString("music_loudness_normalization")}</span>
          <span className="text-xs text-chrome-neutral-500">{getString("music_loudness_normalization_desc")}</span>
        </span>
        <ToggleSwitch checked={normalization} onChange={setNormalization} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center justify-between">
          <span className="text-sm text-chrome-neutral-200">{getString("music_playback_speed")}</span>
          <span className="font-mono text-xs text-chrome-neutral-400">{formatSpeed(speed)}</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SPEED_PRESETS.map((rate) => (
            <Chip key={rate} active={speed === rate} onClick={() => setSpeed(rate)} className="h-7 px-2.5 text-xs">
              {formatSpeed(rate)}
            </Chip>
          ))}
        </div>
        <Slider
          min={0.5}
          max={2}
          step={0.05}
          value={speed}
          onChange={(rate) => setSpeed(Math.round(rate * 100) / 100)}
          aria-label={getString("music_playback_speed")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-chrome-neutral-200">{getString("music_crossfade")}</span>
            <span className="text-xs text-chrome-neutral-500">{getString("music_crossfade_desc")}</span>
          </span>
          <ToggleSwitch checked={crossfade} onChange={setCrossfade} />
        </div>
        {crossfade && (
          <div className="flex items-center gap-3">
            <Slider
              min={1}
              max={12}
              step={1}
              value={crossfadeSeconds}
              onChange={setCrossfadeSeconds}
              aria-label={getString("music_crossfade")}
              className="flex-1"
            />
            <span className="w-10 text-right font-mono text-xs text-chrome-neutral-400">
              {getString("music_crossfade_seconds", crossfadeSeconds)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
