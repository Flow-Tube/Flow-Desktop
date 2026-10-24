import { writeBackupFile } from "../../api/files";
import { isTauriEnv } from "../../api/env";
import { pickSaveFile } from "../../dialogs";
import { formatAutoEq } from "./autoEqFormat";
import { autoPreampDb } from "./filterMath";
import type { EqState } from "./models";
import { activeCopy } from "./stateOps";

/**
 * The active curve as EqualizerAPO text. With auto preamp on, the file carries the preamp Flow
 * would apply, so it plays without clipping in EqualizerAPO too.
 */
export function eqExportText(state: EqState): string {
  const curve = activeCopy(state).curve;
  const bands = curve.bands.filter((b) => b.enabled);
  return formatAutoEq({ ...curve, preamp: state.autoPreamp ? autoPreampDb(bands) : curve.preamp });
}

/** Saves `text` where the user picks; false when they cancel. Throws when the write fails. */
export async function saveEqTextFile(text: string, title: string, defaultName: string): Promise<boolean> {
  if (!(await isTauriEnv())) return false;
  const path = await pickSaveFile(title, defaultName, [{ name: "EqualizerAPO", extensions: ["txt"] }]);
  if (!path) return false;
  await writeBackupFile(path, text);
  return true;
}

/** A file's base name, for a preset imported from it. */
export const presetNameFromFile = (fileName: string): string => fileName.replace(/\.[^.]+$/, "").trim();
