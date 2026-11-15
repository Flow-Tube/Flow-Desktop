import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { setSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";

/** The font Flow draws its text in. Inter is Desktop's own default; the rest match Android's choices. */
export type AppFont = "inter" | "system" | "condensed" | "serif" | "custom";

const FONTS: readonly AppFont[] = ["inter", "system", "condensed", "serif", "custom"];
export const CUSTOM_FONT_FAMILY = "FlowCustomFont";
export const MAX_FONT_MB = 10;

export const isAppFont = (value: string): value is AppFont => FONTS.includes(value as AppFont);

/**
 * Whether a TrueType or OpenType file has a weight axis. Such a font is registered for every weight,
 * so a heading asks for 700 and gets the font's own bold; a static file stays one weight, so the
 * browser still makes a bold for it instead of drawing every weight the same.
 */
export function hasWeightAxis(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(4);
  let fvar = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    if (at + 16 > bytes.length) return false;
    if (String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!) === "fvar") fvar = view.getUint32(at + 8);
  }
  if (fvar < 0 || fvar + 16 > bytes.length) return false;
  const axesOffset = view.getUint16(fvar + 4);
  const axisCount = view.getUint16(fvar + 8);
  const axisSize = view.getUint16(fvar + 10);
  for (let k = 0; k < axisCount; k++) {
    const at = fvar + axesOffset + k * axisSize;
    if (at + 4 > bytes.length) return false;
    if (String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!) === "wght") return true;
  }
  return false;
}

let registered: FontFace | null = null;

/** Registers the font file under Flow's custom family; false when the browser can't read it as a font. */
async function registerCustomFont(bytes: Uint8Array): Promise<boolean> {
  const face = new FontFace(CUSTOM_FONT_FAMILY, bytes.slice().buffer, hasWeightAxis(bytes) ? { weight: "1 1000" } : {});
  try {
    await face.load();
  } catch {
    return false;
  }
  if (registered) document.fonts.delete(registered);
  document.fonts.add(face);
  registered = face;
  return true;
}

export type FontImportError = "not_font" | "too_large" | "unreadable";

/** Checks a picked file, makes it the app font and keeps it for next time. */
export async function importCustomFont(file: File): Promise<FontImportError | null> {
  if (!/\.(ttf|otf)$/i.test(file.name)) return "not_font";
  if (file.size === 0 || file.size > MAX_FONT_MB * 1024 * 1024) return "too_large";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(await registerCustomFont(bytes))) return "unreadable";
  try {
    await invoke("save_custom_font", bytes);
  } catch {
    return "unreadable";
  }
  await setSettingValue(SETTINGS.APP_FONT_CUSTOM_NAME, file.name.replace(/\.(ttf|otf)$/i, ""));
  await setSettingValue(SETTINGS.APP_FONT, "custom");
  return null;
}

export const fontImportMessage = (error: FontImportError): string =>
  error === "not_font"
    ? getString("font_import_not_font")
    : error === "too_large"
      ? getString("font_import_too_large", MAX_FONT_MB)
      : getString("font_import_unreadable");

/**
 * Puts the chosen font on the page. A custom choice whose file is gone or no longer reads as a font,
 * such as after restoring a backup on another computer, is drawn in the system font.
 */
export function useAppFont(): void {
  const stored = useAppSettingsStore((state) => state.values[SETTINGS.APP_FONT] ?? "inter");
  const font: AppFont = isAppFont(stored) ? stored : "inter";
  useEffect(() => {
    const root = document.documentElement;
    if (font !== "custom") {
      root.dataset.appFont = font;
      return;
    }
    let cancelled = false;
    void (async () => {
      let ok = false;
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_custom_font"));
        ok = bytes.length > 0 && (registered !== null || (await registerCustomFont(bytes)));
      } catch {
        ok = false;
      }
      if (!cancelled) root.dataset.appFont = ok ? "custom" : "system";
    })();
    return () => {
      cancelled = true;
    };
  }, [font]);
}
