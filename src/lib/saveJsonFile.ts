import { isTauriEnv } from "./api/env";
import { writeBackupFile } from "./api/files";
import { pickSaveFile } from "./dialogs";

/** Saves through the native dialog in the app and as a browser download elsewhere. False when cancelled. */
export async function saveJsonFile(title: string, defaultName: string, json: string): Promise<boolean> {
  if (await isTauriEnv()) {
    const savePath = await pickSaveFile(title, defaultName, [{ name: "JSON", extensions: ["json"] }]);
    if (!savePath) return false;
    await writeBackupFile(savePath, json);
    return true;
  }

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultName;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
