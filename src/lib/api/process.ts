import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

/** Quits Flow, as the sleep timer's "Quit Flow when it ends" asks. */
export async function quitApp(): Promise<void> {
  if (!(await isTauriEnv())) return;
  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(0);
}

/** Restarts Flow without re-running the command line it was opened with. */
export async function relaunchFlow(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("relaunch_app");
}
