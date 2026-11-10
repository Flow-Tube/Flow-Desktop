import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

export async function globalMediaKeysSupported(): Promise<boolean> {
  if (!(await isTauriEnv())) return false;
  try {
    return await invokeBackend<boolean>("global_media_keys_supported");
  } catch {
    return false;
  }
}

/** Rejects when the system refuses the keys. */
export async function setGlobalMediaKeys(enabled: boolean): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("global_media_keys_set", { enabled });
}
