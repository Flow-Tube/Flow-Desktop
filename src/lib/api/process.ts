import { isTauriEnv } from "./env";

/** Quits Flow, as the sleep timer's "Quit Flow when it ends" asks. */
export async function quitApp(): Promise<void> {
  if (!(await isTauriEnv())) return;
  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(0);
}
