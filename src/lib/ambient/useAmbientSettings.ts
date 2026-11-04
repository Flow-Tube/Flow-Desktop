import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";
import { AMBIENT_INTENSITY_DEFAULT } from "./pipeline";

export function parseAmbientIntensity(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 10 && value <= 100 ? value : AMBIENT_INTENSITY_DEFAULT;
}

export function useAmbientSettings() {
  const enabled = useAppSettingsStore((state) => state.values[SETTINGS.AMBIENT_MODE_ENABLED] === "true");
  const glow = useAppSettingsStore((state) => state.values[SETTINGS.AMBIENT_GLOW_ENABLED] === "true");
  const intensity = useAppSettingsStore((state) => parseAmbientIntensity(state.values[SETTINGS.AMBIENT_MODE_INTENSITY]));
  return { enabled, glow, intensity };
}
