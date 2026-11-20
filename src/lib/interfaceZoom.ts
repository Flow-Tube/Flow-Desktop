import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { isPopOutWindow } from "./api/pip";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

/** The sizes a browser steps through, so Cmd+= feels the same as it does there. */
export const INTERFACE_ZOOMS: readonly number[] = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export function readInterfaceZoom(value: string | undefined): number {
  const zoom = Number(value);
  return Number.isFinite(zoom) && zoom >= INTERFACE_ZOOMS[0]! && zoom <= INTERFACE_ZOOMS[INTERFACE_ZOOMS.length - 1]! ? zoom : 1;
}

/** One step larger (1) or smaller (-1) than `zoom`, or 1 for actual size (0). */
export function stepInterfaceZoom(zoom: number, step: -1 | 0 | 1): number {
  if (step === 0) return 1;
  const larger = INTERFACE_ZOOMS.find((size) => size > zoom + 0.001);
  const smaller = [...INTERFACE_ZOOMS].reverse().find((size) => size < zoom - 0.001);
  return (step > 0 ? larger : smaller) ?? zoom;
}

export function setInterfaceZoom(zoom: number): Promise<boolean> {
  return useAppSettingsStore.getState().setSettingValue(SETTINGS.INTERFACE_ZOOM, String(zoom));
}

export const currentInterfaceZoom = () => readInterfaceZoom(useAppSettingsStore.getState().values[SETTINGS.INTERFACE_ZOOM]);

/**
 * Applies the interface size to this window's webview. The pop-out player keeps its own size, since
 * its controls are already scaled to the small window.
 */
export function useInterfaceZoom(): void {
  const zoom = useAppSettingsStore((state) => readInterfaceZoom(state.values[SETTINGS.INTERFACE_ZOOM]));
  useEffect(() => {
    if (isPopOutWindow()) return;
    void getCurrentWebview()
      .setZoom(zoom)
      .catch((error: unknown) => console.warn("Failed to set the interface size", error));
  }, [zoom]);
}
