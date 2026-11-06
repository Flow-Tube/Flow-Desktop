import { useGlobalMediaKeys } from "../../lib/useGlobalMediaKeys";

// Headless controller that keeps the system's media keys in step with the setting.
export function GlobalMediaKeysController() {
  useGlobalMediaKeys();
  return null;
}
