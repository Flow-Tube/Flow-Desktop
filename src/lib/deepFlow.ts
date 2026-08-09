import { getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { getSettingValue, setSettingValue } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";

export const DEEP_FLOW_NEVER_EXPIRES_HOURS = 0;

export type DeepFlowDisableReason = "manual" | "timer";

export const DEEP_FLOW_DURATION_OPTIONS = [
  DEEP_FLOW_NEVER_EXPIRES_HOURS,
  1,
  2,
  4,
  6,
  8,
  12,
  24,
] as const;

export function getDeepFlowDurationLabel(hours: number): string {
  switch (hours) {
    case DEEP_FLOW_NEVER_EXPIRES_HOURS:
      return getString("deep_flow_duration_never");
    case 1:
      return getString("deep_flow_duration_1h");
    case 2:
      return getString("deep_flow_duration_2h");
    case 4:
      return getString("deep_flow_duration_4h");
    case 6:
      return getString("deep_flow_duration_6h");
    case 8:
      return getString("deep_flow_duration_8h");
    case 12:
      return getString("deep_flow_duration_12h");
    case 24:
      return getString("deep_flow_duration_24h");
    default:
      return getString("deep_flow_duration_hours", hours);
  }
}

export function getDeepFlowRemainingMs(
  active = getSettingValue(SETTINGS.DEEP_FLOW_ACTIVE) === "true",
  activatedAt = Number(getSettingValue(SETTINGS.DEEP_FLOW_ACTIVATED_AT)),
  expireHours = Number(getSettingValue(SETTINGS.DEEP_FLOW_EXPIRE_HOURS)),
): number | null {
  if (!active) return null;
  if (!activatedAt) return 0;
  if (expireHours === DEEP_FLOW_NEVER_EXPIRES_HOURS) return null;
  return activatedAt + expireHours * 3_600_000 - Date.now();
}

let healingCorruptState = false;

export function isDeepFlowCurrentlyActive(): boolean {
  const active = getSettingValue(SETTINGS.DEEP_FLOW_ACTIVE) === "true";
  if (!active) return false;

  const activatedAt = Number(getSettingValue(SETTINGS.DEEP_FLOW_ACTIVATED_AT));
  if (!activatedAt) {
    if (!healingCorruptState) {
      healingCorruptState = true;
      void setSettingValue(SETTINGS.DEEP_FLOW_ACTIVE, "false").finally(() => {
        healingCorruptState = false;
      });
    }
    return false;
  }

  const remainingMs = getDeepFlowRemainingMs(active, activatedAt);
  return remainingMs === null || remainingMs > 0;
}

export function shouldSaveHistoryInDeepFlow(): boolean {
  return getSettingValue(SETTINGS.DEEP_FLOW_SAVE_HISTORY) === "true";
}

export function shouldRecordWatchHistory(): boolean {
  return !isDeepFlowCurrentlyActive() || shouldSaveHistoryInDeepFlow();
}

function showDeepFlowToast(active: boolean, reason: DeepFlowDisableReason) {
  const message = active
    ? getString("deep_flow_enabled_message")
    : reason === "timer"
      ? getString("deep_flow_expired_message")
      : getString("deep_flow_disabled_message");

  useUiStore.getState().showToast({
    message,
    variant: active ? "success" : "info",
  });
}

export async function setDeepFlowEnabled(
  enabled: boolean,
  reason: DeepFlowDisableReason = "manual",
): Promise<boolean> {
  const rawEnabled = getSettingValue(SETTINGS.DEEP_FLOW_ACTIVE) === "true";
  const effectivelyEnabled = isDeepFlowCurrentlyActive();
  if (rawEnabled === enabled && effectivelyEnabled === enabled) return enabled;

  if (enabled) {
    const timestampSaved = await setSettingValue(SETTINGS.DEEP_FLOW_ACTIVATED_AT, String(Date.now()));
    if (!timestampSaved) return false;
    const activeSaved = await setSettingValue(SETTINGS.DEEP_FLOW_ACTIVE, "true");
    if (!activeSaved) return false;
  } else {
    const activeSaved = await setSettingValue(SETTINGS.DEEP_FLOW_ACTIVE, "false");
    if (!activeSaved) return false;
    await setSettingValue(SETTINGS.DEEP_FLOW_ACTIVATED_AT, "0");
  }

  showDeepFlowToast(enabled, reason);
  return enabled;
}

export async function toggleDeepFlow(): Promise<boolean> {
  return setDeepFlowEnabled(!isDeepFlowCurrentlyActive());
}
