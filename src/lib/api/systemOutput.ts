import { listen } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

/** Sent by the backend with `true` while the computer's sound output is muted or at zero. */
const SYSTEM_OUTPUT_SILENT_EVENT = "flow:system-output-silent";

/** Starts or stops the backend's watch on the system output; false where the desktop can't report it. */
export async function watchSystemOutput(enabled: boolean): Promise<boolean> {
  if (!(await isTauriEnv())) return false;
  try {
    return await invokeBackend<boolean>("system_output_watch", { enabled });
  } catch {
    return false;
  }
}

export async function onSystemOutputSilent(handler: (silent: boolean) => void): Promise<() => void> {
  if (!(await isTauriEnv())) return () => {};
  return listen<boolean>(SYSTEM_OUTPUT_SILENT_EVENT, (event) => handler(event.payload));
}
